import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { recordPipelineEvent } from "@/lib/admin/pipeline";
import { createId, db, schema, touch } from "@/lib/db";
import { enqueueMaterialJob } from "@/lib/materials/queue";
import { splitIntoSentences } from "@/lib/nlp/sentence-split";
import { enqueueArticleAudioJob } from "@/lib/original-audio/queue";
import type { ScrapeJob } from "@/db/schema";

export type ScrapeJobStatus = "pending" | "running" | "succeeded" | "failed";

export interface ScrapedArticle {
  title: string;
  url: string;
  content: string;
  category?: string | null;
  publishedAt?: string | Date | null;
}

export interface WorkerJobResponse {
  jobId?: string;
  status?: string;
  error?: string;
}

export interface WorkerScrapeResponse {
  articles?: ScrapedArticle[];
  error?: string;
}

export interface ScrapeJobApi {
  jobId: string;
  status: string;
  maxArticles: number;
  createdCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface IngestScrapeJobInput {
  jobId: string;
  status: Exclude<ScrapeJobStatus, "pending">;
  articles?: ScrapedArticle[];
  errorMessage?: string | null;
}

const DEFAULT_MAX_ARTICLES = 5;
const MAX_ARTICLES_LIMIT = 10;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_WORKER_TIMEOUT_SECONDS = 600;
const STALE_JOB_LOCK_MINUTES = 20;

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1500);
}

async function recordScrapeEvent(input: Parameters<typeof recordPipelineEvent>[0]): Promise<void> {
  await recordPipelineEvent(input).catch((error) => {
    console.error("Failed to record scrape pipeline event:", error);
  });
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function getMaxAttempts(): number {
  return Math.max(1, Math.trunc(envNumber("SCRAPER_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS)));
}

function getWorkerTimeoutMs(): number {
  const seconds = Math.max(
    30,
    Math.trunc(envNumber("SCRAPER_WORKER_TIMEOUT_SECONDS", DEFAULT_WORKER_TIMEOUT_SECONDS))
  );
  return seconds * 1000;
}

function getBackoffMinutes(attempts: number): number {
  return Math.min(30, 2 ** Math.max(1, attempts - 1));
}

export function normalizeWorkerScrapeUrl(rawUrl: string | undefined): string {
  const url = rawUrl || "http://wsj-worker:8000/scrape";
  if (/\/scrape\/?$/.test(url)) {
    return url;
  }
  return url.replace(/\/jobs\/?$/, "/scrape");
}

function parsePublishedAt(value: ScrapedArticle["publishedAt"]): Date {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value;
  }

  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) {
      return date;
    }
  }

  return new Date();
}

async function getScrapeJob(id: string): Promise<ScrapeJob | null> {
  return (await db.query.scrapeJobs.findFirst({ where: eq(schema.scrapeJobs.id, id) })) || null;
}

async function enqueueOriginalAudioIfMissing(articleId: string): Promise<boolean> {
  const existing = await db.query.articles.findFirst({
    where: eq(schema.articles.id, articleId),
    with: {
      originalAudio: true,
      originalAudioJob: true,
    },
  });

  if (!existing || existing.originalAudioJob || existing.originalAudio?.status === "ready") {
    return false;
  }

  try {
    await enqueueArticleAudioJob(articleId);
    return true;
  } catch (error) {
    console.error("Failed to enqueue original-audio job:", error);
    return false;
  }
}

async function createArticleIfNew(article: ScrapedArticle): Promise<{
  created: boolean;
  audioQueued: boolean;
}> {
  const existing = await db.query.articles.findFirst({
    where: eq(schema.articles.url, article.url),
    columns: { id: true },
  });

  if (existing) {
    return {
      created: false,
      audioQueued: await enqueueOriginalAudioIfMissing(existing.id),
    };
  }

  const sentences = splitIntoSentences(article.content);
  const articleId = createId("article");
  const now = touch();

  const inserted = db.transaction((tx) => {
    const created = tx.insert(schema.articles)
      .values({
        id: articleId,
        title: article.title,
        url: article.url,
        content: article.content,
        category: article.category || null,
        publishedAt: parsePublishedAt(article.publishedAt),
        createdAt: now,
      })
      .onConflictDoNothing({ target: schema.articles.url })
      .returning({ id: schema.articles.id })
      .get();

    if (created && sentences.length > 0) {
      tx.insert(schema.sentences)
        .values(sentences.map((text, index) => ({
          id: createId("sentence"),
          articleId,
          text,
          index,
        })))
        .run();
    }

    return created;
  });

  const effectiveArticleId = inserted?.id ?? (
    await db.query.articles.findFirst({
      where: eq(schema.articles.url, article.url),
      columns: { id: true },
    })
  )?.id;

  if (!effectiveArticleId) {
    return { created: false, audioQueued: false };
  }

  if (inserted) {
    await enqueueMaterialJob(effectiveArticleId);
  }

  return {
    created: Boolean(inserted),
    audioQueued: await enqueueOriginalAudioIfMissing(effectiveArticleId),
  };
}

export function normalizeMaxArticles(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_ARTICLES;
  }

  return Math.min(MAX_ARTICLES_LIMIT, Math.max(1, Math.trunc(value)));
}

export function toScrapeJobApi(job: ScrapeJob): ScrapeJobApi {
  return {
    jobId: job.id,
    status: job.status,
    maxArticles: job.maxArticles,
    createdCount: job.createdCount,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString() || null,
    finishedAt: job.finishedAt?.toISOString() || null,
  };
}

export async function createScrapeJob(maxArticles: number): Promise<{
  job: ScrapeJob;
  accepted: boolean;
  error?: string;
}> {
  const now = touch();
  const [job] = await db
    .insert(schema.scrapeJobs)
    .values({
      id: createId("scrape"),
      status: "pending",
      maxArticles,
      createdCount: 0,
      attempts: 0,
      maxAttempts: getMaxAttempts(),
      runAfter: now,
      lockedAt: null,
      lastError: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  console.log(`Queued WSJ scrape job ${job.id} for up to ${maxArticles} articles`);
  await recordScrapeEvent({
    scope: "scrape",
    entityType: "scrapeJob",
    entityId: job.id,
    jobId: job.id,
    status: "queued",
    message: "Scrape job queued",
    metadata: { maxArticles },
  });
  return { job, accepted: true };
}

export const createAndStartScrapeJob = createScrapeJob;

async function recoverStaleScrapeJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_JOB_LOCK_MINUTES * 60 * 1000);
  const now = touch();

  await db
    .update(schema.scrapeJobs)
    .set({
      status: "pending",
      lockedAt: null,
      lastError: "Recovered stale scrape job",
      errorMessage: "Recovered stale scrape job",
      runAfter: now,
      updatedAt: now,
    })
    .where(and(eq(schema.scrapeJobs.status, "running"), lt(schema.scrapeJobs.lockedAt, staleBefore)))
    .run();
}

async function claimScrapeJobs(limit: number): Promise<ScrapeJob[]> {
  await recoverStaleScrapeJobs();

  const claimed: ScrapeJob[] = [];
  for (let i = 0; i < limit; i += 1) {
    const candidate = await db.query.scrapeJobs.findFirst({
      where: and(eq(schema.scrapeJobs.status, "pending"), lte(schema.scrapeJobs.runAfter, new Date())),
      orderBy: asc(schema.scrapeJobs.createdAt),
    });

    if (!candidate) {
      break;
    }

    const lockedAt = touch();
    const [updated] = await db
      .update(schema.scrapeJobs)
      .set({
        status: "running",
        lockedAt,
        attempts: sql`${schema.scrapeJobs.attempts} + 1`,
        startedAt: candidate.startedAt || lockedAt,
        lastError: null,
        errorMessage: null,
        updatedAt: lockedAt,
      })
      .where(and(eq(schema.scrapeJobs.id, candidate.id), eq(schema.scrapeJobs.status, "pending")))
      .returning();

    if (updated) {
      await recordScrapeEvent({
        scope: "scrape",
        entityType: "scrapeJob",
        entityId: candidate.id,
        jobId: candidate.id,
        status: "running",
        message: "Scrape job claimed by worker",
        metadata: { attempts: updated.attempts },
      });
      claimed.push(updated);
    }
  }

  return claimed;
}

async function collectArticlesFromWorker(job: ScrapeJob): Promise<ScrapedArticle[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = process.env.SCRAPER_WORKER_SECRET;
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getWorkerTimeoutMs());
  try {
    const response = await fetch(normalizeWorkerScrapeUrl(process.env.WSJ_WORKER_URL), {
      method: "POST",
      headers,
      body: JSON.stringify({ maxArticles: job.maxArticles }),
      cache: "no-store",
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => ({}))) as WorkerScrapeResponse;
    if (!response.ok) {
      throw new Error(data.error || `WSJ worker rejected scrape with ${response.status}`);
    }

    return Array.isArray(data.articles) ? data.articles : [];
  } finally {
    clearTimeout(timeout);
  }
}

async function markScrapeRetryOrFailed(job: ScrapeJob, error: unknown): Promise<void> {
  const lastError = truncateError(error);
  const hasMoreAttempts = job.attempts < job.maxAttempts;
  const now = touch();

  if (!hasMoreAttempts) {
    await db
      .update(schema.scrapeJobs)
      .set({
        status: "failed",
        lockedAt: null,
        lastError,
        errorMessage: lastError,
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.scrapeJobs.id, job.id))
      .run();
    await recordScrapeEvent({
      scope: "scrape",
      entityType: "scrapeJob",
      entityId: job.id,
      jobId: job.id,
      status: "failed",
      message: "Scrape job failed",
      error,
    });
    return;
  }

  const retryAfter = new Date(Date.now() + getBackoffMinutes(job.attempts) * 60 * 1000);
  await db
    .update(schema.scrapeJobs)
    .set({
      status: "pending",
      runAfter: retryAfter,
      lockedAt: null,
      lastError,
      errorMessage: `Retrying after error: ${lastError}`,
      updatedAt: now,
    })
    .where(eq(schema.scrapeJobs.id, job.id))
    .run();
  await recordScrapeEvent({
    scope: "scrape",
    entityType: "scrapeJob",
    entityId: job.id,
    jobId: job.id,
    status: "retrying",
    message: "Scrape job scheduled for retry",
    error,
    metadata: { runAfter: retryAfter.toISOString() },
  });
}

export async function processScrapeJobs(limit = 1): Promise<{
  claimed: number;
  succeeded: number;
  failed: number;
  results: Array<{
    jobId: string;
    status: "succeeded" | "failed";
    createdCount?: number;
    audioQueuedCount?: number;
    error?: string;
  }>;
}> {
  const jobs = await claimScrapeJobs(limit);
  const results: Array<{
    jobId: string;
    status: "succeeded" | "failed";
    createdCount?: number;
    audioQueuedCount?: number;
    error?: string;
  }> = [];

  for (const job of jobs) {
    try {
      console.log(`Processing WSJ scrape job ${job.id} for up to ${job.maxArticles} articles`);
      const articles = await collectArticlesFromWorker(job);
      const result = await ingestScrapeJobUpdate({
        jobId: job.id,
        status: "succeeded",
        articles,
      });
      results.push({
        jobId: job.id,
        status: "succeeded",
        createdCount: result.createdCount,
        audioQueuedCount: result.audioQueuedCount,
      });
      await recordScrapeEvent({
        scope: "scrape",
        entityType: "scrapeJob",
        entityId: job.id,
        jobId: job.id,
        status: "succeeded",
        message: "Scrape job completed",
        metadata: {
          articles: articles.length,
          createdCount: result.createdCount,
          audioQueuedCount: result.audioQueuedCount,
        },
      });
    } catch (error) {
      const message = truncateError(error);
      await markScrapeRetryOrFailed(job, error);
      results.push({ jobId: job.id, status: "failed", error: message });
    }
  }

  return {
    claimed: jobs.length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

export async function ingestScrapeJobUpdate(input: IngestScrapeJobInput): Promise<{
  job: ScrapeJob | null;
  createdCount: number;
  audioQueuedCount: number;
}> {
  console.log(
    `Received WSJ scrape callback job=${input.jobId} status=${input.status} articles=${input.articles?.length || 0}`
  );

  const existingJob = await getScrapeJob(input.jobId);
  if (!existingJob) {
    return { job: null, createdCount: 0, audioQueuedCount: 0 };
  }

  const now = touch();
  if (input.status === "running") {
    await db
      .update(schema.scrapeJobs)
      .set({
        status: "running",
        startedAt: existingJob.startedAt || now,
        lockedAt: existingJob.lockedAt || now,
        errorMessage: null,
        lastError: null,
        updatedAt: now,
      })
      .where(and(eq(schema.scrapeJobs.id, input.jobId), inArray(schema.scrapeJobs.status, ["pending", "running"])))
      .run();

    return {
      job: await getScrapeJob(input.jobId),
      createdCount: 0,
      audioQueuedCount: 0,
    };
  }

  if (input.status === "failed") {
    const errorMessage = input.errorMessage || "WSJ worker failed";
    await db
      .update(schema.scrapeJobs)
      .set({
        status: "failed",
        errorMessage,
        lastError: errorMessage,
        lockedAt: null,
        startedAt: existingJob.startedAt || now,
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.scrapeJobs.id, input.jobId))
      .run();

    return {
      job: await getScrapeJob(input.jobId),
      createdCount: 0,
      audioQueuedCount: 0,
    };
  }

  let createdCount = 0;
  let audioQueuedCount = 0;
  for (const article of input.articles || []) {
    const result = await createArticleIfNew(article);
    if (result.created) {
      createdCount += 1;
    }
    if (result.audioQueued) {
      audioQueuedCount += 1;
    }
  }

  await db
    .update(schema.scrapeJobs)
    .set({
      status: "succeeded",
      createdCount: sql`${schema.scrapeJobs.createdCount} + ${createdCount}`,
      errorMessage: null,
      lastError: null,
      lockedAt: null,
      startedAt: existingJob.startedAt || now,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.scrapeJobs.id, input.jobId))
    .run();

  return {
    job: await getScrapeJob(input.jobId),
    createdCount,
    audioQueuedCount,
  };
}
