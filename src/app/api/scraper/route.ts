import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedByBearer } from "@/lib/api-auth";
import {
  createScrapeJob,
  normalizeMaxArticles,
  toScrapeJobApi,
} from "@/lib/scraper/worker";

async function runScrape(request: NextRequest) {
  if (!isAuthorizedByBearer(request, "SCRAPER_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { maxArticles?: unknown };
  const maxArticles = normalizeMaxArticles(body.maxArticles);
  const result = await createScrapeJob(maxArticles);
  const job = toScrapeJobApi(result.job);

  if (!result.accepted) {
    return NextResponse.json(
      {
        ...job,
        error: result.error || "Failed to queue WSJ scrape job",
      },
      { status: 202 }
    );
  }

  return NextResponse.json(job, { status: 202 });
}

export async function POST(request: NextRequest) {
  return runScrape(request);
}
