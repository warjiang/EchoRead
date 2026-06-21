import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorizedByBearer } from "@/lib/api-auth";
import { processMaterialJobs, regenerateMaterialJob } from "@/lib/materials/queue";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  if (!isAuthorizedByBearer(request, "MATERIAL_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const article = await prisma.article.findUnique({ where: { id }, select: { id: true } });
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  await regenerateMaterialJob(id);
  after(async () => {
    try {
      await processMaterialJobs(1);
    } catch (error) {
      console.error("Background regenerate worker failed:", error);
    }
  });

  return NextResponse.json({
    message: "Regeneration job queued",
    articleId: id,
  });
}
