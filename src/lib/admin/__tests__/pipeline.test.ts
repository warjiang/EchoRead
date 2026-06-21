import test from "node:test";
import assert from "node:assert/strict";
import {
  canResetAdminJobStatus,
  canRetryAdminJobStatus,
  isActiveAdminJobStatus,
  isAdminJobType,
} from "@/lib/admin/service";
import { normalizeError, serializeMetadata } from "@/lib/admin/pipeline";

test("normalizes pipeline errors for event storage", () => {
  assert.equal(normalizeError(null), null);
  assert.equal(normalizeError(new Error("failed"))!.includes("failed"), true);
  assert.equal(normalizeError("x".repeat(9000))!.length, 8000);
});

test("serializes pipeline metadata", () => {
  assert.equal(serializeMetadata(null), null);
  assert.equal(serializeMetadata({ jobId: "job_1", count: 2 }), '{"jobId":"job_1","count":2}');
});

test("classifies admin job types and active statuses", () => {
  assert.equal(isAdminJobType("scrape"), true);
  assert.equal(isAdminJobType("other"), false);
  assert.equal(isActiveAdminJobStatus("running"), true);
  assert.equal(isActiveAdminJobStatus("processing"), true);
  assert.equal(isActiveAdminJobStatus("failed"), false);
});

test("only allows retry/reset for valid job states", () => {
  const now = new Date("2026-06-21T12:00:00.000Z");
  const freshLock = new Date("2026-06-21T11:58:00.000Z");
  const staleLock = new Date("2026-06-21T11:40:00.000Z");

  assert.equal(canRetryAdminJobStatus("failed"), true);
  assert.equal(canRetryAdminJobStatus("running"), false);
  assert.equal(canResetAdminJobStatus("failed", freshLock, now), true);
  assert.equal(canResetAdminJobStatus("running", freshLock, now), false);
  assert.equal(canResetAdminJobStatus("running", staleLock, now), true);
});
