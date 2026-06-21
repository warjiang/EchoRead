import { and, asc, eq, lt, lte, sql } from "drizzle-orm";
import { recordPipelineEvent } from "@/lib/admin/pipeline";
import { createId, db, schema, touch } from "@/lib/db";
import {
  enqueueWsjWorkerTask,
  listCompletedWsjWorkerTasks,
  markWsjWorkerTaskConsumed,
  parseWsjWorkerTaskResult,
} from "@/lib/wsj-worker/tasks";
import type { ArticleAudio, ArticleAudioJob } from "@/db/schema";

export type ArticleAudioStatus =
  | "pending"
  | "processing"
  | "ready"
  | "unavailable"
  | "failed";

export type SentenceAudioStatus = "pending" | "ready" | "unavailable" | "failed";

export type WorkerAudioStatus = "running" | "succeeded" | "unavailable" | "failed";

export interface AudioClipInput {
  sentenceId: string;
  audioUrl?: string | null;
  startMs?: number | null;
  endMs?: number | null;
  status?: SentenceAudioStatus | string | null;
}

export interface IngestArticleAudioInput {
  jobId: string;
  articleId: string;
  status: WorkerAudioStatus;
  sourceUrl?: string | null;
  sourceAudioUrl?: string | null;
  sourcePath?: string | null;
  durationMs?: number | null;
  coverageRatio?: number | null;
  clips?: AudioClipInput[];
  errorMessage?: string | null;
}

export interface ArticleAudioApi {
  status: ArticleAudioStatus;
  sourceAudioUrl: string | null;
  durationMs: number | null;
  coverageRatio: number | null;
  sentenceCount: number;
  clippedCount: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  job: {
    status: string;
    attempts: number;
    maxAttempts: number;
    timeoutSeconds: number;
    lastError: string | null;
  } | null;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_MIN_COVERAGE = 0.9;
const MAX_TIMEOUT_SECONDS = 60 * 60;
const STALE_JOB_LOCK_MINUTES = 20;

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function getMaxAttempts(): number {
  return Math.max(1, Math.trunc(envNumber("ORIGINAL_AUDIO_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS)));
}

export function getMinCoverage(): number {
  const value = envNumber("ORIGINAL_AUDIO_MIN_COVERAGE", DEFAULT_MIN_COVERAGE);
  return Math.max(0, Math.min(1, value));
}

export function normalizeTimeoutSeconds(value: unknown): number {
  const fallback = Math.trunc(envNumber("ORIGINAL_AUDIO_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS));
  const parsed = typeof value === "number" ? value : Number(value);
  const next = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(30, Math.min(MAX_TIMEOUT_SECONDS, next));
}

function getBackoffMinutes(attempts: number): number {
  return Math.min(30, 2 ** Math.max(1, attempts - 1));
}

export function isCoverageReady(
  clippedCount: number,
  sentenceCount: number,
  threshold = getMinCoverage()
): boolean {
  return sentenceCount > 0 && clippedCount / sentenceCount >= threshold;
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1500);
}

async function recordAudioEvent(input: Parameters<typeof recordPipelineEvent>[0]): Promise<void> {
  await recordPipelineEvent(input).catch((error) => {
    console.error("Failed to record original-audio pipeline event:", error);
  });
}

export function serializeArticleAudio(
  audio: ArticleAudio | null | undefined,
  job?: ArticleAudioJob | null
): ArticleAudioApi {
  return {
    status: (audio?.status as ArticleAudioStatus | undefined) || "pending",
    sourceAudioUrl: audio?.sourceAudioUrl || null,
    durationMs: audio?.durationMs || null,
    coverageRatio: audio?.coverageRatio ?? null,
    sentenceCount: audio?.sentenceCount || 0,
    clippedCount: audio?.clippedCount || 0,
    lastError: audio?.lastError || null,
    startedAt: audio?.startedAt?.toISOString() || null,
    finishedAt: audio?.finishedAt?.toISOString() || null,
    job: job
      ? {
          status: job.status,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          timeoutSeconds: job.timeoutSeconds,
          lastError: job.lastError,
        }
      : null,
  };
}

export async function enqueueArticleAudioJob(articleId: string): Promise<void> {
  const now = touch();

  db.transaction((tx) => {
    tx.insert(schema.articleAudio)
      .values({
        id: createId("audio"),
        articleId,
        status: "pending",
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: schema.articleAudio.articleId })
      .run();

    tx.insert(schema.articleAudioJobs)
      .values({
        id: createId("audiojob"),
        articleId,
        status: "pending",
        attempts: 0,
        maxAttempts: getMaxAttempts(),
        timeoutSeconds: normalizeTimeoutSeconds(undefined),
        runAfter: now,
        lockedAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: schema.articleAudioJobs.articleId })
      .run();
  });
  await recordAudioEvent({
    scope: "audio",
    entityType: "article",
    entityId: articleId,
    articleId,
    status: "queued",
    message: "Original audio job queued",
  });
}

export async function retryArticleAudioJob(articleId: string, timeoutSeconds: unknown): Promise<void> {
  const now = touch();
  const normalizedTimeout = normalizeTimeoutSeconds(timeoutSeconds);

  db.transaction((tx) => {
    tx.insert(schema.articleAudio)
      .values({
        id: createId("audio"),
        articleId,
        status: "pending",
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.articleAudio.articleId,
        set: {
          status: "pending",
          lastError: null,
          startedAt: null,
          finishedAt: null,
          updatedAt: now,
        },
      })
      .run();

    tx.insert(schema.articleAudioJobs)
      .values({
        id: createId("audiojob"),
        articleId,
        status: "pending",
        attempts: 0,
        maxAttempts: getMaxAttempts(),
        timeoutSeconds: normalizedTimeout,
        runAfter: now,
        lockedAt: null,
        workerJobId: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.articleAudioJobs.articleId,
        set: {
          status: "pending",
          attempts: 0,
          maxAttempts: getMaxAttempts(),
          timeoutSeconds: normalizedTimeout,
          runAfter: now,
          lockedAt: null,
          workerJobId: null,
          lastError: null,
          updatedAt: now,
        },
      })
      .run();

    tx.update(schema.sentences)
      .set({
        wsjAudioUrl: null,
        wsjAudioStartMs: null,
        wsjAudioEndMs: null,
        wsjAudioStatus: "pending",
      })
      .where(eq(schema.sentences.articleId, articleId))
      .run();
  });
  await recordAudioEvent({
    scope: "manual",
    entityType: "article",
    entityId: articleId,
    articleId,
    status: "queued",
    message: "Original audio retry queued",
    metadata: { timeoutSeconds: normalizedTimeout },
  });
}

async function recoverStaleJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_JOB_LOCK_MINUTES * 60 * 1000);
  const now = touch();

  await db
    .update(schema.articleAudioJobs)
    .set({
      status: "pending",
      lockedAt: null,
      workerJobId: null,
      lastError: "Recovered stale original-audio job",
      runAfter: now,
      updatedAt: now,
    })
    .where(and(eq(schema.articleAudioJobs.status, "processing"), lt(schema.articleAudioJobs.lockedAt, staleBefore)))
    .run();
}

async function claimJobs(limit: number): Promise<ArticleAudioJob[]> {
  await recoverStaleJobs();

  const claimed: ArticleAudioJob[] = [];
  for (let i = 0; i < limit; i += 1) {
    const candidate = await db.query.articleAudioJobs.findFirst({
      where: and(eq(schema.articleAudioJobs.status, "pending"), lte(schema.articleAudioJobs.runAfter, new Date())),
      orderBy: asc(schema.articleAudioJobs.createdAt),
    });

    if (!candidate) {
      break;
    }

    const lockedAt = touch();
    const [updated] = await db
      .update(schema.articleAudioJobs)
      .set({
        status: "processing",
        lockedAt,
        workerJobId: null,
        attempts: sql`${schema.articleAudioJobs.attempts} + 1`,
        lastError: null,
        updatedAt: lockedAt,
      })
      .where(and(eq(schema.articleAudioJobs.id, candidate.id), eq(schema.articleAudioJobs.status, "pending")))
      .returning();

    if (updated) {
      await recordAudioEvent({
        scope: "audio",
        entityType: "articleAudioJob",
        entityId: candidate.id,
        articleId: candidate.articleId,
        jobId: candidate.id,
        status: "running",
        message: "Original audio job claimed by worker",
        metadata: { attempts: updated.attempts },
      });
      claimed.push(updated);
    }
  }

  return claimed;
}

async function markRetryOrFailed(job: ArticleAudioJob, error: unknown): Promise<void> {
  const lastError = truncateError(error);
  const hasMoreAttempts = job.attempts < job.maxAttempts;
  const now = touch();

  if (!hasMoreAttempts) {
    db.transaction((tx) => {
      tx.update(schema.articleAudioJobs)
        .set({
          status: "failed",
          lockedAt: null,
          workerJobId: null,
          lastError,
          updatedAt: now,
        })
        .where(eq(schema.articleAudioJobs.id, job.id))
        .run();
      tx.update(schema.articleAudio)
        .set({
          status: "failed",
          lastError,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.articleAudio.articleId, job.articleId))
        .run();
    });
    await recordAudioEvent({
      scope: "audio",
      entityType: "articleAudioJob",
      entityId: job.id,
      articleId: job.articleId,
      jobId: job.id,
      status: "failed",
      message: "Original audio job failed",
      error,
    });
    return;
  }

  const retryAfter = new Date(Date.now() + getBackoffMinutes(job.attempts) * 60 * 1000);
  db.transaction((tx) => {
    tx.update(schema.articleAudioJobs)
      .set({
        status: "pending",
        runAfter: retryAfter,
        lockedAt: null,
        workerJobId: null,
        lastError,
        updatedAt: now,
      })
      .where(eq(schema.articleAudioJobs.id, job.id))
      .run();
    tx.update(schema.articleAudio)
      .set({
        status: "pending",
        lastError: `Retrying after error: ${lastError}`,
        updatedAt: now,
      })
      .where(eq(schema.articleAudio.articleId, job.articleId))
      .run();
  });
  await recordAudioEvent({
    scope: "audio",
    entityType: "articleAudioJob",
    entityId: job.id,
    articleId: job.articleId,
    jobId: job.id,
    status: "retrying",
    message: "Original audio job scheduled for retry",
    error,
    metadata: { runAfter: retryAfter.toISOString() },
  });
}

async function dispatchWorkerTask(job: ArticleAudioJob): Promise<string> {
  const article = await db.query.articles.findFirst({
    where: eq(schema.articles.id, job.articleId),
    columns: { id: true, title: true, url: true },
  });

  if (!article) {
    throw new Error("Article not found");
  }

  const sentences = await db.query.sentences.findMany({
    where: eq(schema.sentences.articleId, job.articleId),
    orderBy: asc(schema.sentences.index),
    columns: { id: true, index: true, text: true },
  });

  await db
    .update(schema.articleAudio)
    .set({
      status: "processing",
      sentenceCount: sentences.length,
      startedAt: touch(),
      finishedAt: null,
      lastError: null,
      updatedAt: touch(),
    })
    .where(eq(schema.articleAudio.articleId, job.articleId))
    .run();

  const task = await enqueueWsjWorkerTask({
    kind: "audio",
    domainJobId: job.id,
    domainAttempt: job.attempts,
    payload: {
      jobId: job.id,
      articleId: article.id,
      articleUrl: article.url,
      title: article.title,
      sentences,
      timeoutSeconds: job.timeoutSeconds,
      coverageThreshold: getMinCoverage(),
    },
  });

  await db
    .update(schema.articleAudioJobs)
    .set({
      workerJobId: task.id,
      updatedAt: touch(),
    })
    .where(eq(schema.articleAudioJobs.id, job.id))
    .run();

  return task.id;
}

export async function processArticleAudioJobs(limit = 2): Promise<{
  claimed: number;
  completed: number;
  accepted: number;
  failed: number;
  results: Array<{ jobId: string; status: "accepted" | "completed" | "failed"; taskId?: string; error?: string }>;
}> {
  const results: Array<{ jobId: string; status: "accepted" | "completed" | "failed"; taskId?: string; error?: string }> = [];

  const completedTasks = await listCompletedWsjWorkerTasks("audio", limit);
  for (const task of completedTasks) {
    const job = await db.query.articleAudioJobs.findFirst({ where: eq(schema.articleAudioJobs.id, task.domainJobId) });
    try {
      if (!job || job.attempts !== task.domainAttempt || job.status !== "processing") {
        await markWsjWorkerTaskConsumed(task.id);
        continue;
      }

      if (task.status === "failed") {
        const error = task.lastError || "Original-audio Python worker failed";
        await markRetryOrFailed(job, error);
        results.push({ jobId: job.id, status: "failed", taskId: task.id, error });
        await markWsjWorkerTaskConsumed(task.id);
        continue;
      }

      const data = parseWsjWorkerTaskResult(task, "audio") as IngestArticleAudioInput | null;
      if (!data || data.jobId !== job.id || data.articleId !== job.articleId) {
        throw new Error("Original-audio worker task returned an invalid job payload");
      }

      const result = await ingestArticleAudioUpdate(data);
      if (!result.job) {
        throw new Error("Original-audio worker result did not match a queued job");
      }
      results.push({ jobId: job.id, status: data.status === "failed" ? "failed" : "completed", taskId: task.id });
      await markWsjWorkerTaskConsumed(task.id);
    } catch (error) {
      if (job) {
        await markRetryOrFailed(job, error);
        results.push({ jobId: job.id, status: "failed", taskId: task.id, error: truncateError(error) });
      }
      await markWsjWorkerTaskConsumed(task.id);
    }
  }

  const remainingLimit = Math.max(0, limit - completedTasks.length);
  const jobs = remainingLimit > 0 ? await claimJobs(remainingLimit) : [];

  for (const job of jobs) {
    try {
      const taskId = await dispatchWorkerTask(job);
      await recordAudioEvent({
        scope: "audio",
        entityType: "articleAudioJob",
        entityId: job.id,
        articleId: job.articleId,
        jobId: job.id,
        status: "queued",
        message: "Original audio worker task queued",
        metadata: { taskId, attempts: job.attempts },
      });
      results.push({ jobId: job.id, status: "accepted", taskId });
    } catch (error) {
      await markRetryOrFailed(job, error);
      results.push({ jobId: job.id, status: "failed", error: truncateError(error) });
    }
  }

  return {
    claimed: completedTasks.length + jobs.length,
    completed: results.filter((result) => result.status === "completed").length,
    accepted: results.filter((result) => result.status === "accepted").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

function normalizeClipStatus(status: unknown): SentenceAudioStatus {
  return status === "ready" || status === "failed" || status === "unavailable"
    ? status
    : "unavailable";
}

async function markUnavailable(input: IngestArticleAudioInput): Promise<ArticleAudioJob | null> {
  const job = await db.query.articleAudioJobs.findFirst({ where: eq(schema.articleAudioJobs.id, input.jobId) });
  if (!job) {
    return null;
  }

  const message = input.errorMessage || "No accessible WSJ article audio found";
  const now = touch();
  db.transaction((tx) => {
    tx.update(schema.articleAudioJobs)
      .set({
        status: "succeeded",
        lockedAt: null,
        workerJobId: null,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(schema.articleAudioJobs.id, job.id))
      .run();
    tx.update(schema.articleAudio)
      .set({
        status: "unavailable",
        lastError: message,
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.articleAudio.articleId, input.articleId))
      .run();
    tx.update(schema.sentences)
      .set({
        wsjAudioStatus: "unavailable",
      })
      .where(eq(schema.sentences.articleId, input.articleId))
      .run();
  });
  await recordAudioEvent({
    scope: "audio",
    entityType: "articleAudioJob",
    entityId: job.id,
    articleId: input.articleId,
    jobId: job.id,
    status: "unavailable",
    message,
  });

  return job;
}

async function markSucceeded(input: IngestArticleAudioInput): Promise<ArticleAudioJob | null> {
  const job = await db.query.articleAudioJobs.findFirst({ where: eq(schema.articleAudioJobs.id, input.jobId) });
  if (!job) {
    return null;
  }

  const articleSentences = await db.query.sentences.findMany({
    where: eq(schema.sentences.articleId, input.articleId),
    columns: { id: true },
  });
  const sentenceIds = new Set(articleSentences.map((sentence) => sentence.id));
  const readyClips = (input.clips || []).filter(
    (clip) => clip.sentenceId && sentenceIds.has(clip.sentenceId) && clip.audioUrl && normalizeClipStatus(clip.status) === "ready"
  );
  const sentenceCount = sentenceIds.size;
  const coverageRatio = sentenceCount > 0 ? readyClips.length / sentenceCount : 0;
  const effectiveCoverage = typeof input.coverageRatio === "number" ? input.coverageRatio : coverageRatio;
  const threshold = getMinCoverage();

  if (!isCoverageReady(readyClips.length, sentenceCount, threshold) || effectiveCoverage < threshold) {
    await markRetryOrFailed(job, `Original-audio coverage ${effectiveCoverage.toFixed(2)} is below ${threshold.toFixed(2)}`);
    return job;
  }

  const now = touch();
  db.transaction((tx) => {
    tx.insert(schema.articleAudio)
      .values({
        id: createId("audio"),
        articleId: input.articleId,
        status: "ready",
        sourceUrl: input.sourceUrl || null,
        sourceAudioUrl: input.sourceAudioUrl || null,
        sourcePath: input.sourcePath || null,
        durationMs: input.durationMs || null,
        coverageRatio: effectiveCoverage,
        sentenceCount,
        clippedCount: readyClips.length,
        lastError: null,
        finishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.articleAudio.articleId,
        set: {
          status: "ready",
          sourceUrl: input.sourceUrl || null,
          sourceAudioUrl: input.sourceAudioUrl || null,
          sourcePath: input.sourcePath || null,
          durationMs: input.durationMs || null,
          coverageRatio: effectiveCoverage,
          sentenceCount,
          clippedCount: readyClips.length,
          lastError: null,
          finishedAt: now,
          updatedAt: now,
        },
      })
      .run();

    tx.update(schema.articleAudioJobs)
      .set({
        status: "succeeded",
        lockedAt: null,
        workerJobId: null,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(schema.articleAudioJobs.id, job.id))
      .run();

    tx.update(schema.sentences)
      .set({
        wsjAudioStatus: "unavailable",
        wsjAudioUrl: null,
        wsjAudioStartMs: null,
        wsjAudioEndMs: null,
      })
      .where(eq(schema.sentences.articleId, input.articleId))
      .run();

    for (const clip of readyClips) {
      tx.update(schema.sentences)
        .set({
          wsjAudioStatus: "ready",
          wsjAudioUrl: clip.audioUrl || null,
          wsjAudioStartMs: typeof clip.startMs === "number" ? Math.trunc(clip.startMs) : null,
          wsjAudioEndMs: typeof clip.endMs === "number" ? Math.trunc(clip.endMs) : null,
        })
        .where(eq(schema.sentences.id, clip.sentenceId))
        .run();
    }
  });
  await recordAudioEvent({
    scope: "audio",
    entityType: "articleAudioJob",
    entityId: job.id,
    articleId: input.articleId,
    jobId: job.id,
    status: "succeeded",
    message: "Original audio job completed",
    metadata: {
      coverageRatio: effectiveCoverage,
      clippedCount: readyClips.length,
      sentenceCount,
    },
  });

  return job;
}

export async function ingestArticleAudioUpdate(input: IngestArticleAudioInput): Promise<{
  job: ArticleAudioJob | null;
}> {
  const job = await db.query.articleAudioJobs.findFirst({ where: eq(schema.articleAudioJobs.id, input.jobId) });
  if (!job || job.articleId !== input.articleId) {
    return { job: null };
  }

  if (input.status === "running") {
    const now = touch();
    db.transaction((tx) => {
      tx.update(schema.articleAudioJobs)
        .set({
          status: "processing",
          lockedAt: job.lockedAt || now,
          workerJobId: job.workerJobId || job.id,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(schema.articleAudioJobs.id, job.id))
        .run();
      tx.insert(schema.articleAudio)
        .values({
          id: createId("audio"),
          articleId: input.articleId,
          status: "processing",
          startedAt: now,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.articleAudio.articleId,
          set: {
            status: "processing",
            startedAt: now,
            finishedAt: null,
            lastError: null,
            updatedAt: now,
          },
        })
        .run();
    });
    return { job };
  }

  if (input.status === "unavailable") {
    return { job: await markUnavailable(input) };
  }

  if (input.status === "failed") {
    await markRetryOrFailed(job, input.errorMessage || "Original-audio worker failed");
    return { job };
  }

  return { job: await markSucceeded(input) };
}
