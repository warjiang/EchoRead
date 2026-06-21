import { and, desc, eq } from "drizzle-orm";
import { createId, db, schema, touch } from "@/lib/db";

export type PipelineScope = "scrape" | "material" | "audio" | "article" | "manual" | "worker";
export type PipelineStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying"
  | "unavailable"
  | "deleted"
  | "updated"
  | "heartbeat";

export interface RecordPipelineEventInput {
  scope: PipelineScope;
  entityType: string;
  entityId?: string | null;
  articleId?: string | null;
  jobId?: string | null;
  status: PipelineStatus | string;
  message: string;
  error?: unknown;
  metadata?: Record<string, unknown> | null;
  durationMs?: number | null;
}

export interface PipelineEventRecord {
  id: string;
  scope: string;
  entityType: string;
  entityId: string | null;
  articleId: string | null;
  jobId: string | null;
  status: string;
  message: string;
  errorMessage: string | null;
  metadataJson: string | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface WorkerHeartbeatRecord {
  workerId: string;
  status: string;
  stage: string | null;
  message: string | null;
  lastError: string | null;
  metadataJson: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function truncate(value: string, length: number): string {
  return value.length > length ? value.slice(0, length) : value;
}

export function normalizeError(error: unknown): string | null {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return truncate(message, 8000);
}

export function serializeMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  return JSON.stringify(metadata);
}

export async function recordPipelineEvent(input: RecordPipelineEventInput): Promise<void> {
  await db.insert(schema.pipelineEvents).values({
    id: createId("evt"),
    scope: input.scope,
    entityType: input.entityType,
    entityId: input.entityId || null,
    articleId: input.articleId || null,
    jobId: input.jobId || null,
    status: String(input.status),
    message: truncate(input.message, 500),
    errorMessage: normalizeError(input.error),
    metadataJson: serializeMetadata(input.metadata),
    durationMs: typeof input.durationMs === "number" ? Math.trunc(input.durationMs) : null,
    createdAt: touch(),
  }).run();
}

export async function listPipelineEvents(input: {
  articleId?: string | null;
  entityType?: string | null;
  status?: string | null;
  limit: number;
}): Promise<PipelineEventRecord[]> {
  const conditions = [
    input.articleId ? eq(schema.pipelineEvents.articleId, input.articleId) : undefined,
    input.entityType ? eq(schema.pipelineEvents.entityType, input.entityType) : undefined,
    input.status ? eq(schema.pipelineEvents.status, input.status) : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

  return db.query.pipelineEvents.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: desc(schema.pipelineEvents.createdAt),
    limit: input.limit,
  });
}

export async function listWorkerHeartbeats(limit: number): Promise<WorkerHeartbeatRecord[]> {
  return db.query.workerHeartbeats.findMany({
    orderBy: desc(schema.workerHeartbeats.lastSeenAt),
    limit,
  });
}

export async function recordWorkerHeartbeat(input: {
  workerId: string;
  status: "idle" | "running" | "failed" | "stopped";
  stage?: string | null;
  message?: string | null;
  error?: unknown;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const now = touch();
  const data = {
    workerId: input.workerId,
    status: input.status,
    stage: input.stage || null,
    message: input.message || null,
    lastError: normalizeError(input.error),
    metadataJson: serializeMetadata(input.metadata),
    lastSeenAt: now,
  };

  await db
    .insert(schema.workerHeartbeats)
    .values({
      ...data,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.workerHeartbeats.workerId,
      set: {
        status: data.status,
        stage: data.stage,
        message: data.message,
        lastError: data.lastError,
        metadataJson: data.metadataJson,
        lastSeenAt: data.lastSeenAt,
        updatedAt: now,
      },
    })
    .run();
}
