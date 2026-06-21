import { after, NextRequest, NextResponse } from "next/server";
import { isAuthorizedByBearer } from "@/lib/api-auth";
import { processMaterialJobs } from "@/lib/materials/queue";
import {
  ingestScrapeJobUpdate,
  toScrapeJobApi,
  type IngestScrapeJobInput,
  type ScrapedArticle,
} from "@/lib/scraper/worker";

function isScrapedArticle(value: unknown): value is ScrapedArticle {
  if (!value || typeof value !== "object") {
    return false;
  }

  const article = value as Record<string, unknown>;
  return (
    typeof article.title === "string" &&
    article.title.trim().length >= 10 &&
    typeof article.url === "string" &&
    article.url.trim().length > 0 &&
    typeof article.content === "string" &&
    article.content.trim().length >= 100
  );
}

function parseIngestPayload(value: unknown): IngestScrapeJobInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.jobId !== "string" || payload.jobId.trim().length === 0) {
    return null;
  }

  if (!["running", "succeeded", "failed"].includes(String(payload.status))) {
    return null;
  }

  const articles = Array.isArray(payload.articles)
    ? payload.articles.filter(isScrapedArticle)
    : undefined;

  return {
    jobId: payload.jobId,
    status: payload.status as IngestScrapeJobInput["status"],
    articles,
    errorMessage: typeof payload.errorMessage === "string" ? payload.errorMessage : null,
  };
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedByBearer(request, "SCRAPER_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = parseIngestPayload(await request.json().catch(() => null));
  if (!payload) {
    return NextResponse.json({ error: "Invalid ingest payload" }, { status: 400 });
  }

  const result = await ingestScrapeJobUpdate(payload);
  if (!result.job) {
    return NextResponse.json({ error: "Scrape job not found" }, { status: 404 });
  }

  if (result.createdCount > 0) {
    after(async () => {
      try {
        await processMaterialJobs(Math.min(result.createdCount, 3));
      } catch (error) {
        console.error("Background material worker failed:", error);
      }
    });
  }

  return NextResponse.json({
    job: toScrapeJobApi(result.job),
    createdCount: result.createdCount,
  });
}
