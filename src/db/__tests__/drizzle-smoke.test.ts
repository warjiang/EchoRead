import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { and, count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2)}`;
}

async function createTempDb() {
  const dir = await mkdtemp(path.join(tmpdir(), "echoread-drizzle-"));
  const filename = path.join(dir, "test.db");
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  const migration = await readFile(path.join(process.cwd(), "drizzle", "0000_lowly_whirlwind.sql"), "utf8");
  sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""));
  return {
    db: drizzle(sqlite, { schema }),
    sqlite,
    cleanup: async () => {
      sqlite.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function rowCount(db: ReturnType<typeof drizzle<typeof schema>>, table: typeof schema.articles) {
  const [row] = await db.select({ value: count() }).from(table);
  return row?.value ?? 0;
}

test("drizzle sqlite schema supports core pipeline contracts", async () => {
  const { db, cleanup } = await createTempDb();
  try {
    const now = new Date("2026-06-21T00:00:00.000Z");
    const later = new Date("2026-06-21T00:00:01.000Z");
    const articleId = id("article");
    const sentenceId = id("sentence");

    await db.insert(schema.articles).values({
      id: articleId,
      title: "WSJ Test Article",
      url: "https://example.com/wsj-test",
      content: "First sentence. Second sentence.",
      publishedAt: now,
      createdAt: now,
    });
    await db.insert(schema.sentences).values({
      id: sentenceId,
      articleId,
      index: 0,
      text: "First sentence.",
    });

    const scrapeJobId = id("scrape");
    await db.insert(schema.scrapeJobs).values({
      id: scrapeJobId,
      status: "pending",
      maxArticles: 5,
      createdCount: 0,
      attempts: 0,
      maxAttempts: 3,
      runAfter: now,
      createdAt: now,
      updatedAt: now,
    });
    const [claimedScrape] = await db
      .update(schema.scrapeJobs)
      .set({
        status: "running",
        attempts: sql`${schema.scrapeJobs.attempts} + 1`,
        lockedAt: later,
        updatedAt: later,
      })
      .where(and(eq(schema.scrapeJobs.id, scrapeJobId), eq(schema.scrapeJobs.status, "pending")))
      .returning();
    assert.equal(claimedScrape.status, "running");
    assert.equal(claimedScrape.attempts, 1);
    assert.equal(claimedScrape.updatedAt.toISOString(), later.toISOString());

    await db
      .update(schema.scrapeJobs)
      .set({ status: "pending", lockedAt: null, lastError: "retry", runAfter: later, updatedAt: later })
      .where(eq(schema.scrapeJobs.id, scrapeJobId));
    const retriedScrape = await db.query.scrapeJobs.findFirst({ where: eq(schema.scrapeJobs.id, scrapeJobId) });
    assert.equal(retriedScrape?.status, "pending");

    const trainingId = id("training");
    await db
      .insert(schema.trainingPackages)
      .values({
        id: trainingId,
        articleId,
        status: "pending",
        promptVersion: "v1",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.trainingPackages.articleId,
        set: { status: "succeeded", payloadJson: "{\"ok\":true}", updatedAt: later },
      });
    await db
      .insert(schema.trainingPackages)
      .values({
        id: id("training"),
        articleId,
        status: "pending",
        promptVersion: "v1",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.trainingPackages.articleId,
        set: { status: "succeeded", payloadJson: "{\"ok\":true}", updatedAt: later },
      });
    const training = await db.query.trainingPackages.findFirst({ where: eq(schema.trainingPackages.articleId, articleId) });
    assert.equal(training?.status, "succeeded");
    assert.equal(training?.updatedAt.toISOString(), later.toISOString());

    await db.insert(schema.articleAudio).values({
      id: id("audio"),
      articleId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.articleAudioJobs).values({
      id: id("audiojob"),
      articleId,
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      timeoutSeconds: 300,
      runAfter: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.update(schema.articleAudio).set({
      status: "ready",
      sentenceCount: 1,
      clippedCount: 1,
      coverageRatio: 1,
      updatedAt: later,
    }).where(eq(schema.articleAudio.articleId, articleId));
    await db.update(schema.sentences).set({
      wsjAudioStatus: "ready",
      wsjAudioUrl: `/audio/wsj-clips/${articleId}/${sentenceId}.mp3`,
      wsjAudioStartMs: 100,
      wsjAudioEndMs: 1200,
    }).where(eq(schema.sentences.id, sentenceId));
    const audio = await db.query.articleAudio.findFirst({ where: eq(schema.articleAudio.articleId, articleId) });
    const sentence = await db.query.sentences.findFirst({ where: eq(schema.sentences.id, sentenceId) });
    assert.equal(audio?.status, "ready");
    assert.equal(sentence?.wsjAudioStatus, "ready");

    await db.insert(schema.pipelineEvents).values({
      id: id("evt"),
      scope: "manual",
      entityType: "article",
      entityId: articleId,
      articleId,
      status: "updated",
      message: "smoke",
      createdAt: now,
    });
    await db.insert(schema.workerHeartbeats).values({
      workerId: "smoke",
      status: "idle",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: schema.workerHeartbeats.workerId,
      set: { status: "running", lastSeenAt: later, updatedAt: later },
    });
    await db.insert(schema.workerHeartbeats).values({
      workerId: "smoke",
      status: "idle",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: schema.workerHeartbeats.workerId,
      set: { status: "running", lastSeenAt: later, updatedAt: later },
    });
    const heartbeat = await db.query.workerHeartbeats.findFirst({ where: eq(schema.workerHeartbeats.workerId, "smoke") });
    assert.equal(heartbeat?.status, "running");

    await db.delete(schema.articles).where(eq(schema.articles.id, articleId));
    const [remainingSentences] = await db.select({ value: count() }).from(schema.sentences);
    assert.equal(remainingSentences.value, 0);
    assert.equal(await rowCount(db, schema.articles), 0);
  } finally {
    await cleanup();
  }
});
