import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedByBearer } from "@/lib/api-auth";
import { processArticleAudioJobs } from "@/lib/original-audio/queue";

export async function POST(request: NextRequest) {
  if (!isAuthorizedByBearer(request, "SCRAPER_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") || 2);
  const result = await processArticleAudioJobs(
    Number.isFinite(limit) ? Math.min(10, Math.max(1, Math.trunc(limit))) : 2
  );

  return NextResponse.json(result);
}
