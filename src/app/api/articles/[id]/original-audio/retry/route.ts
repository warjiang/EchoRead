import { after, NextRequest, NextResponse } from "next/server";
import { isAuthorizedByBearer } from "@/lib/api-auth";
import {
  processArticleAudioJobs,
  retryArticleAudioJob,
} from "@/lib/original-audio/queue";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorizedByBearer(request, "SCRAPER_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { timeoutSeconds?: unknown };

  await retryArticleAudioJob(id, body.timeoutSeconds);

  after(async () => {
    try {
      await processArticleAudioJobs(1);
    } catch (error) {
      console.error("Background original-audio retry failed:", error);
    }
  });

  return NextResponse.json({ ok: true });
}
