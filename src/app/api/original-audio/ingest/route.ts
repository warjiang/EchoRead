import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedByBearer } from "@/lib/api-auth";
import {
  ingestArticleAudioUpdate,
  type AudioClipInput,
  type IngestArticleAudioInput,
  type WorkerAudioStatus,
} from "@/lib/original-audio/queue";

function isWorkerStatus(value: unknown): value is WorkerAudioStatus {
  return value === "running" || value === "succeeded" || value === "unavailable" || value === "failed";
}

function parseClip(value: unknown): AudioClipInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const clip = value as Record<string, unknown>;
  if (typeof clip.sentenceId !== "string" || clip.sentenceId.trim().length === 0) {
    return null;
  }

  return {
    sentenceId: clip.sentenceId,
    audioUrl: typeof clip.audioUrl === "string" ? clip.audioUrl : null,
    startMs: typeof clip.startMs === "number" ? clip.startMs : null,
    endMs: typeof clip.endMs === "number" ? clip.endMs : null,
    status: typeof clip.status === "string" ? clip.status : null,
  };
}

function parseIngestPayload(value: unknown): IngestArticleAudioInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.jobId !== "string" || payload.jobId.trim().length === 0) {
    return null;
  }
  if (typeof payload.articleId !== "string" || payload.articleId.trim().length === 0) {
    return null;
  }
  if (!isWorkerStatus(payload.status)) {
    return null;
  }

  const clips = Array.isArray(payload.clips)
    ? payload.clips.map(parseClip).filter((clip): clip is AudioClipInput => Boolean(clip))
    : undefined;

  return {
    jobId: payload.jobId,
    articleId: payload.articleId,
    status: payload.status,
    sourceUrl: typeof payload.sourceUrl === "string" ? payload.sourceUrl : null,
    sourceAudioUrl: typeof payload.sourceAudioUrl === "string" ? payload.sourceAudioUrl : null,
    sourcePath: typeof payload.sourcePath === "string" ? payload.sourcePath : null,
    durationMs: typeof payload.durationMs === "number" ? payload.durationMs : null,
    coverageRatio: typeof payload.coverageRatio === "number" ? payload.coverageRatio : null,
    clips,
    errorMessage: typeof payload.errorMessage === "string" ? payload.errorMessage : null,
  };
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedByBearer(request, "SCRAPER_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = parseIngestPayload(await request.json().catch(() => null));
  if (!payload) {
    return NextResponse.json({ error: "Invalid original-audio ingest payload" }, { status: 400 });
  }

  const result = await ingestArticleAudioUpdate(payload);
  if (!result.job) {
    return NextResponse.json({ error: "Original-audio job not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
