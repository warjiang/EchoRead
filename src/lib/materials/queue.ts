import { prisma } from "@/lib/db";
import {
  MATERIAL_JOB_TYPE,
  serializeTrainingPayload,
  type MaterialJobStatus,
} from "@/lib/materials/persistence";
import { generateTrainingPackage } from "@/lib/materials/service";
import type { MaterialJob, Prisma } from "@prisma/client";

const DEFAULT_MAX_ATTEMPTS = 3;
const STALE_JOB_LOCK_MINUTES = 20;

function getBackoffMinutes(attempts: number): number {
  return Math.min(30, 2 ** Math.max(1, attempts - 1));
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1500);
}

async function ensureTrainingPackage(articleId: string): Promise<void> {
  await prisma.trainingPackage.upsert({
    where: { articleId },
    create: {
      articleId,
      status: "pending",
      promptVersion: "v1",
    },
    update: {},
  });
}

export async function enqueueMaterialJob(articleId: string): Promise<void> {
  await ensureTrainingPackage(articleId);

  try {
    await prisma.materialJob.create({
      data: {
        articleId,
        jobType: MATERIAL_JOB_TYPE,
        status: "pending",
        attempts: 0,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        runAfter: new Date(),
      },
    });
  } catch (error) {
    const prismaError = error as Prisma.PrismaClientKnownRequestError;
    if (prismaError?.code !== "P2002") {
      throw error;
    }
  }
}

export async function regenerateMaterialJob(articleId: string): Promise<void> {
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const existing = await tx.trainingPackage.findUnique({ where: { articleId } });
    await tx.trainingPackage.upsert({
      where: { articleId },
      create: {
        articleId,
        version: 1,
        status: "pending",
        promptVersion: "v1",
        errorMessage: null,
        payloadJson: null,
      },
      update: {
        version: (existing?.version || 0) + 1,
        status: "pending",
        promptVersion: "v1",
        model: null,
        payloadJson: null,
        errorMessage: null,
      },
    });

    await tx.materialJob.upsert({
      where: {
        articleId_jobType: {
          articleId,
          jobType: MATERIAL_JOB_TYPE,
        },
      },
      create: {
        articleId,
        jobType: MATERIAL_JOB_TYPE,
        status: "pending",
        attempts: 0,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        runAfter: now,
        lockedAt: null,
        lastError: null,
      },
      update: {
        status: "pending",
        attempts: 0,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        runAfter: now,
        lockedAt: null,
        lastError: null,
      },
    });
  });
}

async function recoverStaleJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_JOB_LOCK_MINUTES * 60 * 1000);

  await prisma.materialJob.updateMany({
    where: {
      status: "running",
      lockedAt: { lt: staleBefore },
    },
    data: {
      status: "pending",
      lockedAt: null,
      lastError: "Recovered stale running job",
      runAfter: new Date(),
    },
  });
}

async function claimJobs(limit: number): Promise<MaterialJob[]> {
  await recoverStaleJobs();

  const claimed: MaterialJob[] = [];

  for (let i = 0; i < limit; i += 1) {
    const candidate = await prisma.materialJob.findFirst({
      where: {
        status: "pending",
        runAfter: { lte: new Date() },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!candidate) {
      break;
    }

    const updated = await prisma.materialJob.updateMany({
      where: {
        id: candidate.id,
        status: "pending",
      },
      data: {
        status: "running",
        lockedAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    if (updated.count === 1) {
      claimed.push({
        ...candidate,
        status: "running" as MaterialJobStatus,
        attempts: candidate.attempts + 1,
        lockedAt: new Date(),
      });
    }
  }

  return claimed;
}

async function markRetry(job: MaterialJob, error: unknown): Promise<void> {
  const lastError = truncateError(error);
  const attempts = job.attempts;
  const hasMoreAttempts = attempts < job.maxAttempts;

  if (!hasMoreAttempts) {
    await prisma.$transaction([
      prisma.materialJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          lastError,
          lockedAt: null,
        },
      }),
      prisma.trainingPackage.updateMany({
        where: { articleId: job.articleId },
        data: {
          status: "failed",
          errorMessage: lastError,
        },
      }),
    ]);
    return;
  }

  const retryAfter = new Date(Date.now() + getBackoffMinutes(attempts) * 60 * 1000);
  await prisma.$transaction([
    prisma.materialJob.update({
      where: { id: job.id },
      data: {
        status: "pending",
        runAfter: retryAfter,
        lockedAt: null,
        lastError,
      },
    }),
    prisma.trainingPackage.updateMany({
      where: { articleId: job.articleId },
      data: {
        status: "pending",
        errorMessage: `Retrying after error: ${lastError}`,
      },
    }),
  ]);
}

async function processJob(job: MaterialJob): Promise<{ jobId: string; status: "succeeded" | "failed"; error?: string }> {
  const article = await prisma.article.findUnique({
    where: { id: job.articleId },
    select: { id: true, title: true, content: true },
  });

  if (!article) {
    await prisma.materialJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        lastError: "Article not found",
        lockedAt: null,
      },
    });
    return { jobId: job.id, status: "failed", error: "Article not found" };
  }

  await prisma.trainingPackage.updateMany({
    where: { articleId: job.articleId },
    data: {
      status: "running",
      errorMessage: null,
    },
  });

  try {
    const generated = await generateTrainingPackage(article);

    await prisma.$transaction([
      prisma.trainingPackage.upsert({
        where: { articleId: job.articleId },
        create: {
          articleId: job.articleId,
          status: "succeeded",
          model: generated.model,
          promptVersion: generated.promptVersion,
          payloadJson: serializeTrainingPayload(generated.payload),
          errorMessage: null,
        },
        update: {
          status: "succeeded",
          model: generated.model,
          promptVersion: generated.promptVersion,
          payloadJson: serializeTrainingPayload(generated.payload),
          errorMessage: null,
        },
      }),
      prisma.materialJob.update({
        where: { id: job.id },
        data: {
          status: "succeeded",
          lockedAt: null,
          lastError: null,
        },
      }),
    ]);

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
