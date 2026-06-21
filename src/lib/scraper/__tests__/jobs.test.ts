import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMaxArticles, normalizeWorkerScrapeUrl, toScrapeJobApi } from "@/lib/scraper/jobs";
import type { ScrapeJob } from "@/db/schema";

test("normalizes scrape article limits", () => {
  assert.equal(normalizeMaxArticles(undefined), 5);
  assert.equal(normalizeMaxArticles(0), 1);
  assert.equal(normalizeMaxArticles(2.8), 2);
  assert.equal(normalizeMaxArticles(99), 10);
});

test("normalizes worker scrape URLs from async and synchronous endpoints", () => {
  assert.equal(normalizeWorkerScrapeUrl(undefined), "http://wsj-worker:8000/scrape");
  assert.equal(normalizeWorkerScrapeUrl("http://localhost:8000/jobs"), "http://localhost:8000/scrape");
  assert.equal(normalizeWorkerScrapeUrl("http://localhost:8000/scrape"), "http://localhost:8000/scrape");
});

test("serializes scrape jobs for API responses", () => {
  const job = {
    id: "job_123",
    status: "running",
    maxArticles: 3,
    createdCount: 1,
    errorMessage: null,
    startedAt: new Date("2026-06-21T00:00:00.000Z"),
    finishedAt: null,
  } as ScrapeJob;

  assert.deepEqual(toScrapeJobApi(job), {
    jobId: "job_123",
    status: "running",
    maxArticles: 3,
    createdCount: 1,
    errorMessage: null,
    startedAt: "2026-06-21T00:00:00.000Z",
    finishedAt: null,
  });
});
