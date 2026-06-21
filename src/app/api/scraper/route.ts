import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { isAuthorizedByBearer } from "@/lib/api-auth";
import {
  createAndStartScrapeJob,
  normalizeMaxArticles,
  toScrapeJobApi,
} from "@/lib/scraper/worker";

async function runScrape(request: NextRequest) {
  if (!isAuthorizedByBearer(request, "SCRAPER_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { maxArticles?: unknown };
  const maxArticles = normalizeMaxArticles(body.maxArticles);
  let result: Awaited<ReturnType<typeof createAndStartScrapeJob>>;
  try {
    result = await createAndStartScrapeJob(maxArticles);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return NextResponse.json(
        { error: "Database migrations are not applied. Run `prisma migrate deploy` before scraping." },
        { status: 500 }
      );
    }
    throw error;
  }
  const job = toScrapeJobApi(result.job);

  if (!result.accepted) {
    return NextResponse.json(
      {
        ...job,
        error: result.error || "Failed to start WSJ scrape job",
      },
      { status: 202 }
    );
  }

  return NextResponse.json(job, { status: 202 });
}

export async function POST(request: NextRequest) {
  return runScrape(request);
}
