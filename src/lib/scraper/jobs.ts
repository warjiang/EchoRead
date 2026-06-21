import { prisma } from "@/lib/db";
import { enqueueMaterialJob } from "@/lib/materials/queue";
import { splitIntoSentences } from "@/lib/nlp/sentence-split";
import { enqueueArticleAudioJob } from "@/lib/original-audio/queue";
import type { Prisma, ScrapeJob } from "@prisma/client";

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
const WORKER_ACCEPT_TIMEOUT_MS = 10_000;

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1500);
}

function normalizeWorkerJobsUrl(rawUrl: string | undefined): string {
  const url = rawUrl || "http://wsj-worker:8000/jobs";
  return url.replace(/\/scrape\/?$/, "/jobs");
}

function getCallbackUrl(): string {
  const baseUrl =
    process.env.SCRAPER_CALLBACK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  return `${baseUrl.replace(/\/$/, "")}/api/scraper/ingest`;
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

async function enqueueOriginalAudioIfMissing(articleId: string): Promise<boolean> {
  const existing = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      originalAudio: { select: { status: true } },
      originalAudioJob: { select: { id: true } },
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
  const existing = await prisma.article.findUnique({
    where: { url: article.url },
    select: { id: true },
  });

  if (existing) {
    return {
      created: false,
      audioQueued: await enqueueOriginalAudioIfMissing(existing.id),
    };
  }

  const sentences = splitIntoSentences(article.content);

  try {
    const dbArticle = await prisma.article.create({
      data: {
        title: article.title,
        url: article.url,
        content: article.content,
        category: article.category || undefined,
        publishedAt: parsePublishedAt(article.publishedAt),
        sentences: {
          create: sentences.map((text, index) => ({
            text,
            index,
          })),
        },
      },
    });

    await enqueueMaterialJob(dbArticle.id);
    return {
      created: true,
      audioQueued: await enqueueOriginalAudioIfMissing(dbArticle.id),
    };
  } catch (error) {
    const prismaError = error as Prisma.PrismaClientKnownRequestError;
    if (prismaError?.code === "P2002") {
      const existingAfterRace = await prisma.article.findUnique({
        where: { url: article.url },
        select: { id: true },
      });
      return {
        created: false,
        audioQueued: existingAfterRace
          ? await enqueueOriginalAudioIfMissing(existingAfterRace.id)
          : false,
      };
    }
    throw error;
  }
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

export async function createAndStartScrapeJob(maxArticles: number): Promise<{
  job: ScrapeJob;
  accepted: boolean;
  error?: string;
}> {
  const job = await prisma.scrapeJob.create({
    data: {
      status: "pending",
      maxArticles,
      createdCount: 0,
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = process.env.SCRAPER_WORKER_SECRET;
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_ACCEPT_TIMEOUT_MS);

  try {
    console.log(`Creating WSJ scrape job ${job.id} for up to ${maxArticles} articles`);
    const response = await fetch(normalizeWorkerJobsUrl(process.env.WSJ_WORKER_URL), {
      method: "POST",
      headers,
      body: JSON.stringify({
        jobId: job.id,
        maxArticles,
        callbackUrl: getCallbackUrl(),
        callbackSecret: secret || null,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => ({}))) as WorkerJobResponse;
    if (!response.ok) {
      throw new Error(data.error || `WSJ worker rejected job with ${response.status}`);
    }

    console.log(`WSJ scrape job ${job.id} accepted by worker`);
    return { job, accepted: true };
  } catch (error) {
    const errorMessage = truncateError(error);
    console.error(`Failed to start WSJ scrape job ${job.id}:`, errorMessage);
    const failedJob = await prisma.scrapeJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorMessage,
        finishedAt: new Date(),
      },
    });

    return { job: failedJob, accepted: false, error: errorMessage };
  } finally {
    clearTimeout(timeout);
  }
}

export async function ingestScrapeJobUpdate(input: IngestScrapeJobInput): Promise<{
  job: ScrapeJob | null;
  createdCount: number;
  audioQueuedCount: number;
}> {
  console.log(
    `Received WSJ scrape callback job=${input.jobId} status=${input.status} articles=${input.articles?.length || 0}`
  );

  const existingJob = await prisma.scrapeJob.findUnique({ where: { id: input.jobId } });
  if (!existingJob) {
    return { job: null, createdCount: 0, audioQueuedCount: 0 };
  }

  if (input.status === "running") {
    await prisma.scrapeJob.updateMany({
      where: {
        id: input.jobId,
        status: { in: ["pending", "running"] },
      },
      data: {
        status: "running",
        startedAt: new Date(),
        errorMessage: null,
      },
    });

    return {
      job: await prisma.scrapeJob.findUnique({ where: { id: input.jobId } }),
      createdCount: 0,
      audioQueuedCount: 0,
    };
  }

  if (input.status === "failed") {
    await prisma.scrapeJob.updateMany({
      where: { id: input.jobId },
      data: {
        status: "failed",
        errorMessage: input.errorMessage || "WSJ worker failed",
        startedAt: existingJob.startedAt || new Date(),
        finishedAt: new Date(),
      },
    });

    return {
      job: await prisma.scrapeJob.findUnique({ where: { id: input.jobId } }),
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

  await prisma.scrapeJob.updateMany({
    where: { id: input.jobId },
    data: {
      status: "succeeded",
      createdCount: { increment: createdCount },
      errorMessage: null,
      startedAt: existingJob.startedAt || new Date(),
      finishedAt: new Date(),
    },
  });

  return {
    job: await prisma.scrapeJob.findUnique({ where: { id: input.jobId } }),
    createdCount,
    audioQueuedCount,
  };
}
