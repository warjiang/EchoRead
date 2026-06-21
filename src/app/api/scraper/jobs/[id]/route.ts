import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isAuthorizedByBearer } from "@/lib/api-auth";
import { toScrapeJobApi } from "@/lib/scraper/worker";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorizedByBearer(request, "SCRAPER_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const job = await db.query.scrapeJobs.findFirst({ where: eq(schema.scrapeJobs.id, id) });
  if (!job) {
    return NextResponse.json({ error: "Scrape job not found" }, { status: 404 });
  }

  return NextResponse.json(toScrapeJobApi(job));
}
