import { prisma } from "@/lib/db";
import type { ArticleAudio, ArticleAudioJob } from "@prisma/client";

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

function callbackBaseUrl(): string {
  const baseUrl =
    process.env.SCRAPER_CALLBACK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  return baseUrl.replace(/\/$/, "");
}

export function normalizeWorkerAudioJobsUrl(rawUrl: string | undefined): string {
  const url = rawUrl || "http://wsj-worker:8000/audio/jobs";
  if (/\/audio\/jobs\/?$/.test(url)) {
    return url;
  }
  return url.replace(/\/(?:jobs|scrape)\/?$/, "/audio/jobs");
}

function workerUrl(): string {
  return normalizeWorkerAudioJobsUrl(process.env.ORIGINAL_AUDIO_WORKER_URL || process.env.WSJ_WORKER_URL);
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
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.articleAudio.upsert({
      where: { articleId },
      create: {
        articleId,
        status: "pending",
        lastError: null,
      },
      update: {},
    });

    await tx.articleAudioJob.upsert({
      where: { articleId },
      create: {
        articleId,
        status: "pending",
        attempts: 0,
        maxAttempts: getMaxAttempts(),
        timeoutSeconds: normalizeTimeoutSeconds(undefined),
        runAfter: now,
        lockedAt: null,
        lastError: null,
      },
      update: {},
    });
  });
}

export async function retryArticleAudioJob(articleId: string, timeoutSeconds: unknown): Promise<void> {
  const now = new Date();
  const normalizedTimeout = normalizeTimeoutSeconds(timeoutSeconds);

  await prisma.$transaction(async (tx) => {
    await tx.articleAudio.upsert({
      where: { articleId },
      create: {
        articleId,
        status: "pending",
        lastError: null,
      },
      update: {
        status: "pending",
        lastError: null,
        startedAt: null,
        finishedAt: null,
      },
    });

    await tx.articleAudioJob.upsert({
      where: { articleId },
      create: {
        articleId,
        status: "pending",
        attempts: 0,
        maxAttempts: getMaxAttempts(),
        timeoutSeconds: normalizedTimeout,
        runAfter: now,
        lockedAt: null,
        workerJobId: null,
        lastError: null,
      },
      update: {
        status: "pending",
        attempts: 0,
        maxAttempts: getMaxAttempts(),
        timeoutSeconds: normalizedTimeout,
        runAfter: now,
        lockedAt: null,
        workerJobId: null,
        lastError: null,
      },
    });

    await tx.sentence.updateMany({
      where: { articleId },
      data: {
        wsjAudioUrl: null,
        wsjAudioStartMs: null,
        wsjAudioEndMs: null,
        wsjAudioStatus: "pending",
      },
    });
  });
}

async function recoverStaleJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_JOB_LOCK_MINUTES * 60 * 1000);

  await prisma.articleAudioJob.updateMany({
    where: {
      status: "processing",
      lockedAt: { lt: staleBefore },
    },
    data: {
      status: "pending",
      lockedAt: null,
      workerJobId: null,
      lastError: "Recovered stale original-audio job",
      runAfter: new Date(),
    },
  });
}

async function claimJobs(limit: number): Promise<ArticleAudioJob[]> {
  await recoverStaleJobs();

  const claimed: ArticleAudioJob[] = [];
  for (let i = 0; i < limit; i += 1) {
    const candidate = await prisma.articleAudioJob.findFirst({
      where: {
        status: "pending",
        runAfter: { lte: new Date() },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!candidate) {
      break;
    }

    const lockedAt = new Date();
    const updated = await prisma.articleAudioJob.updateMany({
      where: {
        id: candidate.id,
        status: "pending",
      },
      data: {
        status: "processing",
        lockedAt,
        workerJobId: candidate.id,
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    if (updated.count === 1) {
      claimed.push({
        ...candidate,
        status: "processing",
        attempts: candidate.attempts + 1,
        workerJobId: candidate.id,
        lockedAt,
      });
    }
  }

  return claimed;
}

async function markRetryOrFailed(job: ArticleAudioJob, error: unknown): Promise<void> {
  const lastError = truncateError(error);
  const hasMoreAttempts = job.attempts < job.maxAttempts;

  if (!hasMoreAttempts) {
    await prisma.$transaction([
      prisma.articleAudioJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          lockedAt: null,
          workerJobId: null,
          lastError,
        },
      }),
      prisma.articleAudio.updateMany({
        where: { articleId: job.articleId },
        data: {
          status: "failed",
          lastError,
          finishedAt: new Date(),
        },
      }),
    ]);
    return;
  }

  const retryAfter = new Date(Date.now() + getBackoffMinutes(job.attempts) * 60 * 1000);
  await prisma.$transaction([
    prisma.articleAudioJob.update({
      where: { id: job.id },
      data: {
        status: "pending",
        runAfter: retryAfter,
        lockedAt: null,
        workerJobId: null,
        lastError,
      },
    }),
    prisma.articleAudio.updateMany({
      where: { articleId: job.articleId },
      data: {
        status: "pending",
        lastError: `Retrying after error: ${lastError}`,
      },
    }),
  ]);
}

async function startWorkerJob(job: ArticleAudioJob): Promise<void> {
  const article = await prisma.article.findUnique({
    where: { id: job.articleId },
    select: {
      id: true,
      title: true,
      url: true,
      sentences: {
        orderBy: { index: "asc" },
        select: {
          id: true,
          index: true,
          text: true,
        },
      },
    },
  });

  if (!article) {
    throw new Error("Article not found");
  }

  await prisma.articleAudio.updateMany({
    where: { articleId: job.articleId },
    data: {
      status: "processing",
      sentenceCount: article.sentences.length,
      startedAt: new Date(),
      finishedAt: null,
      lastError: null,
    },
  });

  const secret = process.env.SCRAPER_WORKER_SECRET;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const response = await fetch(workerUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      jobId: job.id,
      articleId: article.id,
      articleUrl: article.url,
      title: article.title,
      sentences: article.sentences,
      callbackUrl: `${callbackBaseUrl()}/api/original-audio/ingest`,
      callbackSecret: secret || null,
      timeoutSeconds: job.timeoutSeconds,
      coverageThreshold: getMinCoverage(),
    }),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(data?.error || `Original-audio worker rejected job with ${response.status}`);
  }
}

export async function processArticleAudioJobs(limit = 2): Promise<{
  claimed: number;
  accepted: number;
  failed: number;
  results: Array<{ jobId: string; status: "accepted" | "failed"; error?: string }>;
}> {
  const jobs = await claimJobs(limit);
  const results: Array<{ jobId: string; status: "accepted" | "failed"; error?: string }> = [];

  for (const job of jobs) {
    try {
      await startWorkerJob(job);
      results.push({ jobId: job.id, status: "accepted" });
    } catch (error) {
      await markRetryOrFailed(job, error);
      results.push({ jobId: job.id, status: "failed", error: truncateError(error) });
    }
  }

  return {
    claimed: jobs.length,
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
  const job = await prisma.articleAudioJob.findUnique({ where: { id: input.jobId } });
  if (!job) {
    return null;
  }

  const message = input.errorMessage || "No accessible WSJ article audio found";
  await prisma.$transaction([
    prisma.articleAudioJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        lockedAt: null,
        workerJobId: null,
        lastError: null,
      },
    }),
    prisma.articleAudio.updateMany({
      where: { articleId: input.articleId },
      data: {
        status: "unavailable",
        lastError: message,
        finishedAt: new Date(),
      },
    }),
    prisma.sentence.updateMany({
      where: { articleId: input.articleId },
      data: {
        wsjAudioStatus: "unavailable",
      },
    }),
  ]);

  return job;
}

async function markSucceeded(input: IngestArticleAudioInput): Promise<ArticleAudioJob | null> {
  const job = await prisma.articleAudioJob.findUnique({ where: { id: input.jobId } });
  if (!job) {
    return null;
  }

  const article = await prisma.article.findUnique({
    where: { id: input.articleId },
    select: {
      sentences: {
        select: { id: true },
      },
    },
  });
  const sentenceIds = new Set(article?.sentences.map((sentence) => sentence.id) || []);
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

  await prisma.$transaction(async (tx) => {
    await tx.articleAudio.upsert({
      where: { articleId: input.articleId },
      create: {
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
        finishedAt: new Date(),
      },
      update: {
        status: "ready",
        sourceUrl: input.sourceUrl || null,
        sourceAudioUrl: input.sourceAudioUrl || null,
        sourcePath: input.sourcePath || null,
        durationMs: input.durationMs || null,
        coverageRatio: effectiveCoverage,
        sentenceCount,
        clippedCount: readyClips.length,
        lastError: null,
        finishedAt: new Date(),
      },
    });

    await tx.articleAudioJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        lockedAt: null,
        workerJobId: null,
        lastError: null,
      },
    });

    await tx.sentence.updateMany({
      where: { articleId: input.articleId },
      data: {
        wsjAudioStatus: "unavailable",
        wsjAudioUrl: null,
        wsjAudioStartMs: null,
        wsjAudioEndMs: null,
      },
    });

    for (const clip of readyClips) {
      await tx.sentence.update({
        where: { id: clip.sentenceId },
        data: {
          wsjAudioStatus: "ready",
          wsjAudioUrl: clip.audioUrl || null,
          wsjAudioStartMs: typeof clip.startMs === "number" ? Math.trunc(clip.startMs) : null,
          wsjAudioEndMs: typeof clip.endMs === "number" ? Math.trunc(clip.endMs) : null,
        },
      });
    }
  });

  return job;
}

export async function ingestArticleAudioUpdate(input: IngestArticleAudioInput): Promise<{
  job: ArticleAudioJob | null;
}> {
  const job = await prisma.articleAudioJob.findUnique({ where: { id: input.jobId } });
  if (!job || job.articleId !== input.articleId) {
    return { job: null };
  }

  if (input.status === "running") {
    await prisma.$transaction([
      prisma.articleAudioJob.update({
        where: { id: job.id },
        data: {
          status: "processing",
          lockedAt: job.lockedAt || new Date(),
          workerJobId: job.workerJobId || job.id,
          lastError: null,
        },
      }),
      prisma.articleAudio.upsert({
        where: { articleId: input.articleId },
        create: {
          articleId: input.articleId,
          status: "processing",
          startedAt: new Date(),
          lastError: null,
        },
        update: {
          status: "processing",
          startedAt: new Date(),
          finishedAt: null,
          lastError: null,
        },
      }),
    ]);
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
