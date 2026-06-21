import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { createId, db, schema, touch } from "@/lib/db";
import type { WsjWorkerTask } from "@/db/schema";

export type WsjWorkerTaskKind = "scrape" | "audio";
export type WsjWorkerTaskStatus = "pending" | "running" | "succeeded" | "failed";

export interface WsjWorkerTaskPayloads {
  scrape: {
    maxArticles: number;
  };
  audio: {
    jobId: string;
    articleId: string;
    articleUrl: string;
    title: string;
    sentences: Array<{ id: string; index: number; text: string }>;
    timeoutSeconds: number;
    coverageThreshold: number;
  };
}

export interface WsjWorkerTaskResults {
  scrape: {
    articles?: unknown[];
  };
  audio: unknown;
}

export async function enqueueWsjWorkerTask<K extends WsjWorkerTaskKind>(input: {
  kind: K;
  domainJobId: string;
  domainAttempt: number;
  payload: WsjWorkerTaskPayloads[K];
}): Promise<WsjWorkerTask> {
  const now = touch();
  const [created] = await db
    .insert(schema.wsjWorkerTasks)
    .values({
      id: createId("wsjtask"),
      kind: input.kind,
      domainJobId: input.domainJobId,
      domainAttempt: input.domainAttempt,
      status: "pending",
      payloadJson: JSON.stringify(input.payload),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        schema.wsjWorkerTasks.kind,
        schema.wsjWorkerTasks.domainJobId,
        schema.wsjWorkerTasks.domainAttempt,
      ],
    })
    .returning();

  if (created) {
    return created;
  }

  const existing = await db.query.wsjWorkerTasks.findFirst({
    where: and(
      eq(schema.wsjWorkerTasks.kind, input.kind),
      eq(schema.wsjWorkerTasks.domainJobId, input.domainJobId),
      eq(schema.wsjWorkerTasks.domainAttempt, input.domainAttempt)
    ),
  });

  if (!existing) {
    throw new Error("Failed to create WSJ worker task");
  }

  return existing;
}

export async function listCompletedWsjWorkerTasks(
  kind: WsjWorkerTaskKind,
  limit: number
): Promise<WsjWorkerTask[]> {
  return db.query.wsjWorkerTasks.findMany({
    where: and(
      eq(schema.wsjWorkerTasks.kind, kind),
      inArray(schema.wsjWorkerTasks.status, ["succeeded", "failed"]),
      isNull(schema.wsjWorkerTasks.consumedAt)
    ),
    orderBy: asc(schema.wsjWorkerTasks.finishedAt),
    limit,
  });
}

export async function markWsjWorkerTaskConsumed(taskId: string): Promise<void> {
  const now = touch();
  await db
    .update(schema.wsjWorkerTasks)
    .set({
      consumedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.wsjWorkerTasks.id, taskId))
    .run();
}

export function parseWsjWorkerTaskResult<K extends WsjWorkerTaskKind>(
  task: WsjWorkerTask,
  kind: K
): WsjWorkerTaskResults[K] {
  if (task.kind !== kind) {
    throw new Error(`Expected ${kind} WSJ worker task, received ${task.kind}`);
  }
  if (!task.resultJson) {
    return {} as WsjWorkerTaskResults[K];
  }
  return JSON.parse(task.resultJson) as WsjWorkerTaskResults[K];
}
