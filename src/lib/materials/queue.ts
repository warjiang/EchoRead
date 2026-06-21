import { and, asc, eq, lt, lte, sql } from "drizzle-orm";
import { recordPipelineEvent } from "@/lib/admin/pipeline";
import { createId, db, schema, touch } from "@/lib/db";
import {
  MATERIAL_JOB_TYPE,
  serializeTrainingPayload,
  type MaterialJobStatus,
} from "@/lib/materials/persistence";
import { generateTrainingPackage } from "@/lib/materials/service";
import type { MaterialJob } from "@/db/schema";

const DEFAULT_MAX_ATTEMPTS = 3;
const STALE_JOB_LOCK_MINUTES = 20;

function getBackoffMinutes(attempts: number): number {
  return Math.min(30, 2 ** Math.max(1, attempts - 1));
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 8000);
}

async function recordMaterialEvent(input: Parameters<typeof recordPipelineEvent>[0]): Promise<void> {
  await recordPipelineEvent(input).catch((error) => {
    console.error("Failed to record material pipeline event:", error);
  });
}

async function ensureTrainingPackage(articleId: string): Promise<void> {
  const now = touch();
  await db
    .insert(schema.trainingPackages)
    .values({
      id: createId("training"),
      articleId,
      status: "pending",
      promptVersion: "v1",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: schema.trainingPackages.articleId })
    .run();
}

export async function enqueueMaterialJob(articleId: string): Promise<void> {
  await ensureTrainingPackage(articleId);
  const now = touch();
  const [job] = await db
    .insert(schema.materialJobs)
    .values({
      id: createId("material"),
      articleId,
      jobType: MATERIAL_JOB_TYPE,
      status: "pending",
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      runAfter: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [schema.materialJobs.articleId, schema.materialJobs.jobType] })
    .returning();

  if (job) {
    await recordMaterialEvent({
      scope: "material",
      entityType: "article",
      entityId: articleId,
      articleId,
      status: "queued",
      message: "Material job queued",
    });
  }
}

export async function regenerateMaterialJob(articleId: string): Promise<void> {
  const now = touch();
  const existing = await db.query.trainingPackages.findFirst({
    where: eq(schema.trainingPackages.articleId, articleId),
  });

  db.transaction((tx) => {
    tx.insert(schema.trainingPackages)
      .values({
        id: createId("training"),
        articleId,
        version: 1,
        status: "pending",
        promptVersion: "v1",
        errorMessage: null,
        payloadJson: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.trainingPackages.articleId,
        set: {
          version: (existing?.version || 0) + 1,
          status: "pending",
          promptVersion: "v1",
          model: null,
          payloadJson: null,
          errorMessage: null,
          updatedAt: now,
        },
      })
      .run();

    tx.insert(schema.materialJobs)
      .values({
        id: createId("material"),
        articleId,
        jobType: MATERIAL_JOB_TYPE,
        status: "pending",
        attempts: 0,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        runAfter: now,
        lockedAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.materialJobs.articleId, schema.materialJobs.jobType],
        set: {
          status: "pending",
          attempts: 0,
          maxAttempts: DEFAULT_MAX_ATTEMPTS,
          runAfter: now,
          lockedAt: null,
          lastError: null,
          updatedAt: now,
        },
      })
      .run();
  });
  await recordMaterialEvent({
    scope: "manual",
    entityType: "article",
    entityId: articleId,
    articleId,
    status: "queued",
    message: "Material regeneration queued",
  });
}

async function recoverStaleJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_JOB_LOCK_MINUTES * 60 * 1000);
  const now = touch();

  await db
    .update(schema.materialJobs)
    .set({
      status: "pending",
      lockedAt: null,
      lastError: "Recovered stale running job",
      runAfter: now,
      updatedAt: now,
    })
    .where(and(eq(schema.materialJobs.status, "running"), lt(schema.materialJobs.lockedAt, staleBefore)))
    .run();
}

async function claimJobs(limit: number): Promise<MaterialJob[]> {
  await recoverStaleJobs();

  const claimed: MaterialJob[] = [];

  for (let i = 0; i < limit; i += 1) {
    const candidate = await db.query.materialJobs.findFirst({
      where: and(eq(schema.materialJobs.status, "pending"), lte(schema.materialJobs.runAfter, new Date())),
      orderBy: asc(schema.materialJobs.createdAt),
    });

    if (!candidate) {
      break;
    }

    const lockedAt = touch();
    const [updated] = await db
      .update(schema.materialJobs)
      .set({
        status: "running",
        lockedAt,
        attempts: sql`${schema.materialJobs.attempts} + 1`,
        lastError: null,
        updatedAt: lockedAt,
      })
      .where(and(eq(schema.materialJobs.id, candidate.id), eq(schema.materialJobs.status, "pending")))
      .returning();

    if (updated) {
      await recordMaterialEvent({
        scope: "material",
        entityType: "materialJob",
        entityId: candidate.id,
        articleId: candidate.articleId,
        jobId: candidate.id,
        status: "running",
        message: "Material job claimed by worker",
        metadata: { attempts: updated.attempts },
      });
      claimed.push({
        ...updated,
        status: "running" as MaterialJobStatus,
      });
    }
  }

  return claimed;
}

async function markRetry(job: MaterialJob, error: unknown): Promise<void> {
  const lastError = truncateError(error);
  const attempts = job.attempts;
  const hasMoreAttempts = attempts < job.maxAttempts;
  const now = touch();

  if (!hasMoreAttempts) {
    db.transaction((tx) => {
      tx.update(schema.materialJobs)
        .set({
          status: "failed",
          lastError,
          lockedAt: null,
          updatedAt: now,
        })
        .where(eq(schema.materialJobs.id, job.id))
        .run();
      tx.update(schema.trainingPackages)
        .set({
          status: "failed",
          errorMessage: lastError,
          updatedAt: now,
        })
        .where(eq(schema.trainingPackages.articleId, job.articleId))
        .run();
    });
    await recordMaterialEvent({
      scope: "material",
      entityType: "materialJob",
      entityId: job.id,
      articleId: job.articleId,
      jobId: job.id,
      status: "failed",
      message: "Material job failed",
      error,
    });
    return;
  }

  const retryAfter = new Date(Date.now() + getBackoffMinutes(attempts) * 60 * 1000);
  db.transaction((tx) => {
    tx.update(schema.materialJobs)
      .set({
        status: "pending",
        runAfter: retryAfter,
        lockedAt: null,
        lastError,
        updatedAt: now,
      })
      .where(eq(schema.materialJobs.id, job.id))
      .run();
    tx.update(schema.trainingPackages)
      .set({
        status: "pending",
        errorMessage: `Retrying after error: ${lastError}`,
        updatedAt: now,
      })
      .where(eq(schema.trainingPackages.articleId, job.articleId))
      .run();
  });
  await recordMaterialEvent({
    scope: "material",
    entityType: "materialJob",
    entityId: job.id,
    articleId: job.articleId,
    jobId: job.id,
    status: "retrying",
    message: "Material job scheduled for retry",
    error,
    metadata: { runAfter: retryAfter.toISOString() },
  });
}

async function processJob(job: MaterialJob): Promise<{ jobId: string; status: "succeeded" | "failed"; error?: string }> {
  const article = await db.query.articles.findFirst({
    where: eq(schema.articles.id, job.articleId),
    columns: { id: true, title: true, content: true },
  });

  if (!article) {
    await db
      .update(schema.materialJobs)
      .set({
        status: "failed",
        lastError: "Article not found",
        lockedAt: null,
        updatedAt: touch(),
      })
      .where(eq(schema.materialJobs.id, job.id))
      .run();
    return { jobId: job.id, status: "failed", error: "Article not found" };
  }

  await db
    .update(schema.trainingPackages)
    .set({
      status: "running",
      errorMessage: null,
      updatedAt: touch(),
    })
    .where(eq(schema.trainingPackages.articleId, job.articleId))
    .run();

  try {
    const generated = await generateTrainingPackage(article);
    const now = touch();

    db.transaction((tx) => {
      tx.insert(schema.trainingPackages)
        .values({
          id: createId("training"),
          articleId: job.articleId,
          status: "succeeded",
          model: generated.model,
          promptVersion: generated.promptVersion,
          payloadJson: serializeTrainingPayload(generated.payload),
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.trainingPackages.articleId,
          set: {
            status: "succeeded",
            model: generated.model,
            promptVersion: generated.promptVersion,
            payloadJson: serializeTrainingPayload(generated.payload),
            errorMessage: null,
            updatedAt: now,
          },
        })
        .run();
      tx.update(schema.materialJobs)
        .set({
          status: "succeeded",
          lockedAt: null,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(schema.materialJobs.id, job.id))
        .run();
    });
    await recordMaterialEvent({
      scope: "material",
      entityType: "materialJob",
      entityId: job.id,
      articleId: job.articleId,
      jobId: job.id,
      status: "succeeded",
      message: "Material job completed",
      metadata: { model: generated.model, promptVersion: generated.promptVersion },
    });

    return { jobId: job.id, status: "succeeded" };
  } catch (error) {
    await markRetry(job, error);
    return {
      jobId: job.id,
      status: "failed",
      error: truncateError(error),
    };
  }
}

export async function processMaterialJobs(limit = 2): Promise<{
  claimed: number;
  succeeded: number;
  failed: number;
  results: Array<{ jobId: string; status: "succeeded" | "failed"; error?: string }>;
}> {
  const jobs = await claimJobs(limit);
  const results: Array<{ jobId: string; status: "succeeded" | "failed"; error?: string }> = [];

  for (const job of jobs) {
    const result = await processJob(job);
    results.push(result);
  }

  return {
    claimed: jobs.length,
    succeeded: results.filter((r) => r.status === "succeeded").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}
