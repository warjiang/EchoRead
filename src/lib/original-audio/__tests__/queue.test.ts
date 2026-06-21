import test from "node:test";
import assert from "node:assert/strict";
import {
  getMinCoverage,
  isCoverageReady,
  normalizeWorkerAudioJobsUrl,
  normalizeTimeoutSeconds,
  serializeArticleAudio,
} from "@/lib/original-audio/queue";
import type { ArticleAudio, ArticleAudioJob } from "@prisma/client";

test("normalizes original-audio timeout seconds", () => {
  assert.equal(normalizeTimeoutSeconds(undefined), 300);
  assert.equal(normalizeTimeoutSeconds(10), 30);
  assert.equal(normalizeTimeoutSeconds("600"), 600);
  assert.equal(normalizeTimeoutSeconds(999999), 3600);
});

test("normalizes original-audio worker URLs from manual and docker scraper URLs", () => {
  assert.equal(
    normalizeWorkerAudioJobsUrl("http://localhost:8000/scrape"),
    "http://localhost:8000/audio/jobs"
  );
  assert.equal(
    normalizeWorkerAudioJobsUrl("http://wsj-worker:8000/jobs"),
    "http://wsj-worker:8000/audio/jobs"
  );
  assert.equal(
    normalizeWorkerAudioJobsUrl("http://localhost:8000/audio/jobs"),
    "http://localhost:8000/audio/jobs"
  );
});

test("evaluates readiness against coverage threshold", () => {
  assert.equal(isCoverageReady(9, 10, 0.9), true);
  assert.equal(isCoverageReady(8, 10, 0.9), false);
  assert.equal(isCoverageReady(1, 0, 0.9), false);
});

test("clamps configured minimum coverage", () => {
  const previous = process.env.ORIGINAL_AUDIO_MIN_COVERAGE;
  process.env.ORIGINAL_AUDIO_MIN_COVERAGE = "1.5";
  assert.equal(getMinCoverage(), 1);
  process.env.ORIGINAL_AUDIO_MIN_COVERAGE = "-1";
  assert.equal(getMinCoverage(), 0);
  if (previous === undefined) {
    delete process.env.ORIGINAL_AUDIO_MIN_COVERAGE;
  } else {
    process.env.ORIGINAL_AUDIO_MIN_COVERAGE = previous;
  }
});

test("serializes article audio state for APIs", () => {
  const audio = {
    status: "failed",
    sourceAudioUrl: "/audio/wsj-source/a.mp3",
    durationMs: 1000,
    coverageRatio: 0.5,
    sentenceCount: 10,
    clippedCount: 5,
    lastError: "Timed out",
    startedAt: new Date("2026-06-21T00:00:00.000Z"),
    finishedAt: null,
  } as ArticleAudio;
  const job = {
    status: "failed",
    attempts: 3,
    maxAttempts: 3,
    timeoutSeconds: 600,
    lastError: "Timed out",
  } as ArticleAudioJob;

  assert.deepEqual(serializeArticleAudio(audio, job), {
    status: "failed",
    sourceAudioUrl: "/audio/wsj-source/a.mp3",
    durationMs: 1000,
    coverageRatio: 0.5,
    sentenceCount: 10,
    clippedCount: 5,
    lastError: "Timed out",
    startedAt: "2026-06-21T00:00:00.000Z",
    finishedAt: null,
    job: {
      status: "failed",
      attempts: 3,
      maxAttempts: 3,
      timeoutSeconds: 600,
      lastError: "Timed out",
    },
  });
});
