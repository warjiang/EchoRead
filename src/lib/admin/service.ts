import * as fs from "fs/promises";
import * as path from "path";
import { asc, count, desc, eq, gte, like, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createId, db, schema, touch } from "@/lib/db";
import { enqueueMaterialJob, regenerateMaterialJob } from "@/lib/materials/queue";
import { splitIntoSentences } from "@/lib/nlp/sentence-split";
import { retryArticleAudioJob } from "@/lib/original-audio/queue";
import { createScrapeJob } from "@/lib/scraper/worker";
import { listPipelineEvents, listWorkerHeartbeats, recordPipelineEvent } from "@/lib/admin/pipeline";
import type {
  Article,
  ArticleAudio,
  ArticleAudioJob,
  MaterialJob,
  ScrapeJob,
  Sentence,
  TrainingPackage,
} from "@/db/schema";

export type AdminJobType = "scrape" | "material" | "audio";

const DEFAULT_ARTICLE_LIMIT = 50;
const DEFAULT_JOB_LIMIT = 50;
const DEFAULT_EVENT_LIMIT = 100;
const ACTIVE_JOB_STALE_MS = 15 * 60 * 1000;

type AdminArticleListItem = Article & {
  _count: { sentences: number };
  trainingPackage: TrainingPackage | null;
  originalAudio: ArticleAudio | null;
  materialJobs: MaterialJob[];
  originalAudioJob: ArticleAudioJob | null;
};

type AdminArticleDetail = Article & {
  sentences: Sentence[];
  trainingPackage: TrainingPackage | null;
  materialJobs: MaterialJob[];
  originalAudio: ArticleAudio | null;
  originalAudioJob: ArticleAudioJob | null;
  pipelineEvents: Awaited<ReturnType<typeof listPipelineEvents>>;
};

export function isAdminJobType(value: unknown): value is AdminJobType {
  return value === "scrape" || value === "material" || value === "audio";
}

export function isActiveAdminJobStatus(status: string): boolean {
  return status === "running" || status === "processing";
}

export function canRetryAdminJobStatus(status: string): boolean {
  return !isActiveAdminJobStatus(status);
}

export function canResetAdminJobStatus(status: string, lockedAt?: Date | string | null, now = new Date()): boolean {
  if (!isActiveAdminJobStatus(status)) {
    return true;
  }
  if (!lockedAt) {
    return true;
  }
  return now.valueOf() - new Date(lockedAt).valueOf() >= ACTIVE_JOB_STALE_MS;
}

function assertCanRetry(status: string): void {
  if (!canRetryAdminJobStatus(status)) {
    throw new Error("Running jobs cannot be retried. Reset stale locks first.");
  }
}

function assertCanReset(status: string, lockedAt?: Date | null): void {
  if (!canResetAdminJobStatus(status, lockedAt)) {
    throw new Error("Running jobs cannot be reset until their lock is stale.");
  }
}

function clampLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(200, Math.max(1, Math.trunc(parsed))) : fallback;
}

function publicAudioRoot(): string {
  return path.join(process.cwd(), "public", "audio");
}

async function removeIfExists(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
}

async function removeArticleAudioFiles(articleId: string, sourcePath?: string | null): Promise<void> {
  if (sourcePath) {
    await removeIfExists(sourcePath);
  }

  const audioRoot = publicAudioRoot();
  const sourceRoot = path.join(audioRoot, "wsj-source");
  const clipRoot = path.join(audioRoot, "wsj-clips", articleId);

  const sourceFiles = await fs.readdir(sourceRoot).catch(() => []);
  await Promise.all(
    sourceFiles
      .filter((file) => file.startsWith(articleId))
      .map((file) => removeIfExists(path.join(sourceRoot, file)))
  );
  await removeIfExists(clipRoot);
}

async function countArticles(where?: SQL): Promise<number> {
  const [row] = await db.select({ value: count() }).from(schema.articles).where(where);
  return row?.value ?? 0;
}

async function countRows(table: SQLiteTable, where?: SQL): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(where);
  return row?.value ?? 0;
}

async function getScrapeJobOrThrow(id: string): Promise<ScrapeJob> {
  const job = await db.query.scrapeJobs.findFirst({ where: eq(schema.scrapeJobs.id, id) });
  if (!job) {
    throw new Error("Scrape job not found");
  }
  return job;
}

async function getMaterialJobOrThrow(id: string): Promise<MaterialJob> {
  const job = await db.query.materialJobs.findFirst({ where: eq(schema.materialJobs.id, id) });
  if (!job) {
    throw new Error("Material job not found");
  }
  return job;
}

async function getArticleAudioJobOrThrow(id: string): Promise<ArticleAudioJob> {
  const job = await db.query.articleAudioJobs.findFirst({ where: eq(schema.articleAudioJobs.id, id) });
  if (!job) {
    throw new Error("Original audio job not found");
  }
  return job;
}

export async function getAdminOverview() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    workerHeartbeats,
    articleCount,
    todayScrapes,
    scrapePending,
    scrapeRunning,
    scrapeFailed,
    materialPending,
    materialRunning,
    materialFailed,
    audioPending,
    audioRunning,
    audioFailed,
    trainingSucceeded,
    trainingTotal,
    audioReady,
    audioTotal,
    recentEvents,
  ] = await Promise.all([
    listWorkerHeartbeats(5),
    countArticles(),
    countRows(schema.scrapeJobs, gte(schema.scrapeJobs.createdAt, today)),
    countRows(schema.scrapeJobs, eq(schema.scrapeJobs.status, "pending")),
    countRows(schema.scrapeJobs, eq(schema.scrapeJobs.status, "running")),
    countRows(schema.scrapeJobs, eq(schema.scrapeJobs.status, "failed")),
    countRows(schema.materialJobs, eq(schema.materialJobs.status, "pending")),
    countRows(schema.materialJobs, eq(schema.materialJobs.status, "running")),
    countRows(schema.materialJobs, eq(schema.materialJobs.status, "failed")),
    countRows(schema.articleAudioJobs, eq(schema.articleAudioJobs.status, "pending")),
    countRows(schema.articleAudioJobs, eq(schema.articleAudioJobs.status, "processing")),
    countRows(schema.articleAudioJobs, eq(schema.articleAudioJobs.status, "failed")),
    countRows(schema.trainingPackages, eq(schema.trainingPackages.status, "succeeded")),
    countRows(schema.trainingPackages),
    countRows(schema.articleAudio, eq(schema.articleAudio.status, "ready")),
    countRows(schema.articleAudio),
    listPipelineEvents({ limit: 10 }),
  ]);
  const latestHeartbeat = workerHeartbeats[0];
  const workerOnline = Boolean(
    latestHeartbeat &&
      Date.now() - latestHeartbeat.lastSeenAt.valueOf() < 2 * 60 * 1000 &&
      latestHeartbeat.status !== "failed"
  );

  return {
    workerHeartbeats,
    workerOnline,
    articleCount,
    todayScrapes,
    queues: {
      scrape: { pending: scrapePending, running: scrapeRunning, failed: scrapeFailed },
      material: { pending: materialPending, running: materialRunning, failed: materialFailed },
      audio: { pending: audioPending, running: audioRunning, failed: audioFailed },
    },
    completion: {
      materials: { succeeded: trainingSucceeded, total: trainingTotal },
      audio: { ready: audioReady, total: audioTotal },
    },
    recentEvents,
  };
}

export async function listAdminJobs(input: {
  type?: string | null;
  status?: string | null;
  limit?: unknown;
}) {
  const limit = clampLimit(input.limit, DEFAULT_JOB_LIMIT);
  const status = input.status || undefined;
  const requestedType = input.type as AdminJobType | undefined;
  const types: AdminJobType[] =
    requestedType === "scrape" || requestedType === "material" || requestedType === "audio"
      ? [requestedType]
      : ["scrape", "material", "audio"];

  const [scrapeJobs, materialRows, audioRows] = await Promise.all([
    types.includes("scrape")
      ? db.query.scrapeJobs.findMany({
          where: status ? eq(schema.scrapeJobs.status, status) : undefined,
          orderBy: desc(schema.scrapeJobs.createdAt),
          limit,
        })
      : [],
    types.includes("material")
      ? db
          .select({ job: schema.materialJobs, article: { id: schema.articles.id, title: schema.articles.title } })
          .from(schema.materialJobs)
          .leftJoin(schema.articles, eq(schema.materialJobs.articleId, schema.articles.id))
          .where(status ? eq(schema.materialJobs.status, status) : undefined)
          .orderBy(desc(schema.materialJobs.createdAt))
          .limit(limit)
      : [],
    types.includes("audio")
      ? db
          .select({ job: schema.articleAudioJobs, article: { id: schema.articles.id, title: schema.articles.title } })
          .from(schema.articleAudioJobs)
          .leftJoin(schema.articles, eq(schema.articleAudioJobs.articleId, schema.articles.id))
          .where(status ? eq(schema.articleAudioJobs.status, status) : undefined)
          .orderBy(desc(schema.articleAudioJobs.createdAt))
          .limit(limit)
      : [],
  ]);
  const now = new Date();

  return [
    ...scrapeJobs.map((job) => ({
      id: job.id,
      type: "scrape" as const,
      status: job.status,
      articleId: null,
      articleTitle: null,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      runAfter: job.runAfter,
      lockedAt: job.lockedAt,
      lastError: job.lastError || job.errorMessage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      canRetry: canRetryAdminJobStatus(job.status),
      canReset: canResetAdminJobStatus(job.status, job.lockedAt, now),
      canMarkFailed: canResetAdminJobStatus(job.status, job.lockedAt, now),
    })),
    ...materialRows.map(({ job, article }) => ({
      id: job.id,
      type: "material" as const,
      status: job.status,
      articleId: job.articleId,
      articleTitle: article?.title || job.articleId,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      runAfter: job.runAfter,
      lockedAt: job.lockedAt,
      lastError: job.lastError,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      canRetry: canRetryAdminJobStatus(job.status),
      canReset: canResetAdminJobStatus(job.status, job.lockedAt, now),
      canMarkFailed: canResetAdminJobStatus(job.status, job.lockedAt, now),
    })),
    ...audioRows.map(({ job, article }) => ({
      id: job.id,
      type: "audio" as const,
      status: job.status,
      articleId: job.articleId,
      articleTitle: article?.title || job.articleId,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      runAfter: job.runAfter,
      lockedAt: job.lockedAt,
      lastError: job.lastError,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      canRetry: canRetryAdminJobStatus(job.status),
      canReset: canResetAdminJobStatus(job.status, job.lockedAt, now),
      canMarkFailed: canResetAdminJobStatus(job.status, job.lockedAt, now),
    })),
  ].sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf());
}

export async function queueAdminScrape(maxArticles: unknown = 5) {
  const parsed = Number(maxArticles);
  const result = await createScrapeJob(Number.isFinite(parsed) ? parsed : 5);
  await recordPipelineEvent({
    scope: "manual",
    entityType: "scrapeJob",
    entityId: result.job.id,
    jobId: result.job.id,
    status: "queued",
    message: "Admin queued scrape job",
    metadata: { maxArticles: result.job.maxArticles },
  });
  return result.job;
}

export async function retryAdminJob(type: AdminJobType, id: string) {
  const now = touch();

  if (type === "scrape") {
    const existing = await getScrapeJobOrThrow(id);
    assertCanRetry(existing.status);
    const [job] = await db
      .update(schema.scrapeJobs)
      .set({
        status: "pending",
        attempts: 0,
        runAfter: now,
        lockedAt: null,
        lastError: null,
        errorMessage: null,
        finishedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.scrapeJobs.id, id))
      .returning();
    await recordPipelineEvent({
      scope: "manual",
      entityType: "scrapeJob",
      entityId: id,
      jobId: id,
      status: "queued",
      message: "Admin retried scrape job",
    });
    return job;
  }

  if (type === "material") {
    const existing = await getMaterialJobOrThrow(id);
    assertCanRetry(existing.status);
    const job = db.transaction((tx) => {
      const updated = tx
        .update(schema.materialJobs)
        .set({ status: "pending", attempts: 0, runAfter: now, lockedAt: null, lastError: null, updatedAt: now })
        .where(eq(schema.materialJobs.id, id))
        .returning()
        .get();
      tx.update(schema.trainingPackages)
        .set({ status: "pending", errorMessage: null, updatedAt: now })
        .where(eq(schema.trainingPackages.articleId, updated.articleId))
        .run();
      return updated;
    });
    await recordPipelineEvent({
      scope: "manual",
      entityType: "materialJob",
      entityId: id,
      articleId: job.articleId,
      jobId: id,
      status: "queued",
      message: "Admin retried material job",
    });
    return job;
  }

  const job = await getArticleAudioJobOrThrow(id);
  assertCanRetry(job.status);
  await retryArticleAudioJob(job.articleId, job.timeoutSeconds);
  await recordPipelineEvent({
    scope: "manual",
    entityType: "articleAudioJob",
    entityId: id,
    articleId: job.articleId,
    jobId: id,
    status: "queued",
    message: "Admin retried original audio job",
  });
  return db.query.articleAudioJobs.findFirst({ where: eq(schema.articleAudioJobs.id, id) });
}

export async function resetAdminJob(type: AdminJobType, id: string) {
  const now = touch();
  if (type === "scrape") {
    const existing = await getScrapeJobOrThrow(id);
    assertCanReset(existing.status, existing.lockedAt);
    const [job] = await db
      .update(schema.scrapeJobs)
      .set({
        status: "pending",
        runAfter: now,
        lockedAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(schema.scrapeJobs.id, id))
      .returning();
    await recordPipelineEvent({
      scope: "manual",
      entityType: "scrapeJob",
      entityId: id,
      jobId: id,
      status: "queued",
      message: "Admin reset scrape job to pending",
    });
    return job;
  }
  if (type === "material") {
    const existing = await getMaterialJobOrThrow(id);
    assertCanReset(existing.status, existing.lockedAt);
    const [job] = await db
      .update(schema.materialJobs)
      .set({ status: "pending", runAfter: now, lockedAt: null, lastError: null, updatedAt: now })
      .where(eq(schema.materialJobs.id, id))
      .returning();
    await recordPipelineEvent({
      scope: "manual",
      entityType: "materialJob",
      entityId: id,
      articleId: job.articleId,
      jobId: id,
      status: "queued",
      message: "Admin reset material job to pending",
    });
    return job;
  }
  const existing = await getArticleAudioJobOrThrow(id);
  assertCanReset(existing.status, existing.lockedAt);
  const [job] = await db
    .update(schema.articleAudioJobs)
    .set({ status: "pending", runAfter: now, lockedAt: null, workerJobId: null, lastError: null, updatedAt: now })
    .where(eq(schema.articleAudioJobs.id, id))
    .returning();
  await recordPipelineEvent({
    scope: "manual",
    entityType: "articleAudioJob",
    entityId: id,
    articleId: job.articleId,
    jobId: id,
    status: "queued",
    message: "Admin reset original audio job to pending",
  });
  return job;
}

export async function markAdminJobFailed(type: AdminJobType, id: string, message = "Marked failed by admin") {
  const now = touch();
  if (type === "scrape") {
    const existing = await getScrapeJobOrThrow(id);
    assertCanReset(existing.status, existing.lockedAt);
    const [job] = await db
      .update(schema.scrapeJobs)
      .set({
        status: "failed",
        lockedAt: null,
        lastError: message,
        errorMessage: message,
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.scrapeJobs.id, id))
      .returning();
    await recordPipelineEvent({
      scope: "manual",
      entityType: "scrapeJob",
      entityId: id,
      jobId: id,
      status: "failed",
      message: "Admin marked scrape job failed",
      error: message,
    });
    return job;
  }

  if (type === "material") {
    const existing = await getMaterialJobOrThrow(id);
    assertCanReset(existing.status, existing.lockedAt);
    const job = db.transaction((tx) => {
      const updated = tx
        .update(schema.materialJobs)
        .set({ status: "failed", lockedAt: null, lastError: message, updatedAt: now })
        .where(eq(schema.materialJobs.id, id))
        .returning()
        .get();
      tx.update(schema.trainingPackages)
        .set({ status: "failed", errorMessage: message, updatedAt: now })
        .where(eq(schema.trainingPackages.articleId, updated.articleId))
        .run();
      return updated;
    });
    await recordPipelineEvent({
      scope: "manual",
      entityType: "materialJob",
      entityId: id,
      articleId: job.articleId,
      jobId: id,
      status: "failed",
      message: "Admin marked material job failed",
      error: message,
    });
    return job;
  }

  const existing = await getArticleAudioJobOrThrow(id);
  assertCanReset(existing.status, existing.lockedAt);
  const job = db.transaction((tx) => {
    const updated = tx
      .update(schema.articleAudioJobs)
      .set({ status: "failed", lockedAt: null, workerJobId: null, lastError: message, updatedAt: now })
      .where(eq(schema.articleAudioJobs.id, id))
      .returning()
      .get();
    tx.update(schema.articleAudio)
      .set({ status: "failed", lastError: message, finishedAt: now, updatedAt: now })
      .where(eq(schema.articleAudio.articleId, updated.articleId))
      .run();
    tx.update(schema.sentences)
      .set({ wsjAudioStatus: "failed" })
      .where(eq(schema.sentences.articleId, updated.articleId))
      .run();
    return updated;
  });
  await recordPipelineEvent({
    scope: "manual",
    entityType: "articleAudioJob",
    entityId: id,
    articleId: job.articleId,
    jobId: id,
    status: "failed",
    message: "Admin marked original audio job failed",
    error: message,
  });
  return job;
}

export async function retryFailedAdminJobs(limit: unknown = 50) {
  const take = clampLimit(limit, DEFAULT_JOB_LIMIT);
  const [scrapeJobs, materialJobs, audioJobs] = await Promise.all([
    db.query.scrapeJobs.findMany({ where: eq(schema.scrapeJobs.status, "failed"), columns: { id: true }, limit: take }),
    db.query.materialJobs.findMany({ where: eq(schema.materialJobs.status, "failed"), columns: { id: true }, limit: take }),
    db.query.articleAudioJobs.findMany({ where: eq(schema.articleAudioJobs.status, "failed"), columns: { id: true }, limit: take }),
  ]);

  for (const job of scrapeJobs) {
    await retryAdminJob("scrape", job.id);
  }
  for (const job of materialJobs) {
    await retryAdminJob("material", job.id);
  }
  for (const job of audioJobs) {
    await retryAdminJob("audio", job.id);
  }

  const result = {
    scrape: scrapeJobs.length,
    material: materialJobs.length,
    audio: audioJobs.length,
  };
  await recordPipelineEvent({
    scope: "manual",
    entityType: "worker",
    status: "queued",
    message: "Admin retried failed jobs",
    metadata: result,
  });
  return result;
}

async function hydrateAdminArticle(article: Article): Promise<AdminArticleListItem> {
  const [sentenceCount, trainingPackage, originalAudio, materialJobs, originalAudioJob] = await Promise.all([
    countRows(schema.sentences, eq(schema.sentences.articleId, article.id)),
    db.query.trainingPackages.findFirst({ where: eq(schema.trainingPackages.articleId, article.id) }),
    db.query.articleAudio.findFirst({ where: eq(schema.articleAudio.articleId, article.id) }),
    db.query.materialJobs.findMany({ where: eq(schema.materialJobs.articleId, article.id), orderBy: desc(schema.materialJobs.createdAt) }),
    db.query.articleAudioJobs.findFirst({ where: eq(schema.articleAudioJobs.articleId, article.id) }),
  ]);
  return {
    ...article,
    _count: { sentences: sentenceCount },
    trainingPackage: trainingPackage || null,
    originalAudio: originalAudio || null,
    materialJobs,
    originalAudioJob: originalAudioJob || null,
  };
}

export async function listAdminArticles(input: { limit?: unknown; query?: string | null }): Promise<AdminArticleListItem[]> {
  const limit = clampLimit(input.limit, DEFAULT_ARTICLE_LIMIT);
  const query = input.query?.trim();
  const where = query
    ? or(
        like(schema.articles.title, `%${query}%`),
        like(schema.articles.category, `%${query}%`),
        like(schema.articles.url, `%${query}%`)
      )
    : undefined;
  const articles = await db.query.articles.findMany({
    where,
    orderBy: desc(schema.articles.createdAt),
    limit,
  });
  return Promise.all(articles.map(hydrateAdminArticle));
}

export async function getAdminArticle(id: string): Promise<AdminArticleDetail | null> {
  const [article, pipelineEvents] = await Promise.all([
    db.query.articles.findFirst({ where: eq(schema.articles.id, id) }),
    listPipelineEvents({ articleId: id, limit: 50 }),
  ]);

  if (!article) {
    return null;
  }

  const [sentences, trainingPackage, materialJobs, originalAudio, originalAudioJob] = await Promise.all([
    db.query.sentences.findMany({ where: eq(schema.sentences.articleId, id), orderBy: asc(schema.sentences.index) }),
    db.query.trainingPackages.findFirst({ where: eq(schema.trainingPackages.articleId, id) }),
    db.query.materialJobs.findMany({ where: eq(schema.materialJobs.articleId, id), orderBy: desc(schema.materialJobs.createdAt) }),
    db.query.articleAudio.findFirst({ where: eq(schema.articleAudio.articleId, id) }),
    db.query.articleAudioJobs.findFirst({ where: eq(schema.articleAudioJobs.articleId, id) }),
  ]);

  return {
    ...article,
    sentences,
    trainingPackage: trainingPackage || null,
    materialJobs,
    originalAudio: originalAudio || null,
    originalAudioJob: originalAudioJob || null,
    pipelineEvents,
  };
}

export async function updateAdminArticle(
  id: string,
  input: {
    title?: unknown;
    category?: unknown;
    publishedAt?: unknown;
    content?: unknown;
  }
) {
  const existing = await db.query.articles.findFirst({ where: eq(schema.articles.id, id) });
  if (!existing) {
    throw new Error("Article not found");
  }
  const existingAudio = await db.query.articleAudio.findFirst({ where: eq(schema.articleAudio.articleId, id) });

  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : existing.title;
  const category = typeof input.category === "string" ? input.category.trim() || null : existing.category;
  const content = typeof input.content === "string" && input.content.trim() ? input.content.trim() : existing.content;
  const publishedAt =
    typeof input.publishedAt === "string" && input.publishedAt
      ? new Date(input.publishedAt)
      : existing.publishedAt;
  const contentChanged = content !== existing.content;
  const now = touch();

  db.transaction((tx) => {
    tx.update(schema.articles)
      .set({
        title,
        category,
        content,
        publishedAt: Number.isNaN(publishedAt.valueOf()) ? existing.publishedAt : publishedAt,
      })
      .where(eq(schema.articles.id, id))
      .run();

    if (contentChanged) {
      const sentences = splitIntoSentences(content);
      tx.delete(schema.sentences).where(eq(schema.sentences.articleId, id)).run();
      if (sentences.length > 0) {
        tx.insert(schema.sentences)
          .values(sentences.map((text, index) => ({ id: createId("sentence"), articleId: id, text, index })))
          .run();
      }
      tx.update(schema.trainingPackages)
        .set({ status: "pending", payloadJson: null, errorMessage: "Article content changed", updatedAt: now })
        .where(eq(schema.trainingPackages.articleId, id))
        .run();
      tx.update(schema.articleAudio)
        .set({
          status: "pending",
          sourceAudioUrl: null,
          sourcePath: null,
          durationMs: null,
          coverageRatio: null,
          sentenceCount: sentences.length,
          clippedCount: 0,
          lastError: "Article content changed",
          finishedAt: null,
          updatedAt: now,
        })
        .where(eq(schema.articleAudio.articleId, id))
        .run();
      tx.insert(schema.articleAudioJobs)
        .values({
          id: createId("audiojob"),
          articleId: id,
          status: "pending",
          attempts: 0,
          maxAttempts: 3,
          timeoutSeconds: 300,
          runAfter: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.articleAudioJobs.articleId,
          set: {
            status: "pending",
            attempts: 0,
            runAfter: now,
            lockedAt: null,
            workerJobId: null,
            lastError: null,
            updatedAt: now,
          },
        })
        .run();
    }
  });

  if (contentChanged) {
    await removeArticleAudioFiles(id, existingAudio?.sourcePath);
    await enqueueMaterialJob(id);
  }

  await recordPipelineEvent({
    scope: "manual",
    entityType: "article",
    entityId: id,
    articleId: id,
    status: "updated",
    message: contentChanged ? "Admin updated article and reset derived materials" : "Admin updated article metadata",
    metadata: { contentChanged },
  });

  return getAdminArticle(id);
}

export async function deleteAdminArticle(id: string) {
  const article = await db.query.articles.findFirst({ where: eq(schema.articles.id, id) });
  if (!article) {
    return null;
  }
  const originalAudio = await db.query.articleAudio.findFirst({ where: eq(schema.articleAudio.articleId, id) });

  await removeArticleAudioFiles(id, originalAudio?.sourcePath);
  await recordPipelineEvent({
    scope: "manual",
    entityType: "article",
    entityId: id,
    status: "deleted",
    message: "Admin deleted article and derived assets",
    metadata: { title: article.title },
  });
  await db.delete(schema.articles).where(eq(schema.articles.id, id)).run();
  return { ...article, originalAudio: originalAudio || null };
}

export async function regenerateAdminMaterial(articleId: string) {
  await regenerateMaterialJob(articleId);
  await recordPipelineEvent({
    scope: "manual",
    entityType: "article",
    entityId: articleId,
    articleId,
    status: "queued",
    message: "Admin queued material regeneration",
  });
}

export async function retryAdminOriginalAudio(articleId: string, timeoutSeconds?: unknown) {
  await retryArticleAudioJob(articleId, timeoutSeconds);
  await recordPipelineEvent({
    scope: "manual",
    entityType: "article",
    entityId: articleId,
    articleId,
    status: "queued",
    message: "Admin queued original audio retry",
  });
}

export async function resetAdminOriginalAudio(articleId: string, timeoutSeconds?: unknown) {
  const existing = await db.query.articleAudio.findFirst({ where: eq(schema.articleAudio.articleId, articleId) });
  await removeArticleAudioFiles(articleId, existing?.sourcePath);
  const now = touch();
  db.transaction((tx) => {
    const sentenceCountRow = tx
      .select({ value: count() })
      .from(schema.sentences)
      .where(eq(schema.sentences.articleId, articleId))
      .get();
    const sentenceCount = sentenceCountRow?.value ?? 0;
    tx.insert(schema.articleAudio)
      .values({
        id: createId("audio"),
        articleId,
        status: "pending",
        sentenceCount,
        clippedCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.articleAudio.articleId,
        set: {
          status: "pending",
          sourceUrl: null,
          sourceAudioUrl: null,
          sourcePath: null,
          durationMs: null,
          coverageRatio: null,
          sentenceCount,
          clippedCount: 0,
          lastError: null,
          startedAt: null,
          finishedAt: null,
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
  await retryArticleAudioJob(articleId, timeoutSeconds);
  await recordPipelineEvent({
    scope: "manual",
    entityType: "article",
    entityId: articleId,
    articleId,
    status: "queued",
    message: "Admin deleted original audio files and queued re-cut",
  });
}

export async function listAdminEvents(input: {
  articleId?: string | null;
  entityType?: string | null;
  status?: string | null;
  limit?: unknown;
}) {
  return listPipelineEvents({
    articleId: input.articleId,
    entityType: input.entityType,
    status: input.status,
    limit: clampLimit(input.limit, DEFAULT_EVENT_LIMIT),
  });
}
