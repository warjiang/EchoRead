import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeArticleAudio } from "@/lib/original-audio/queue";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const article = await prisma.article.findUnique({
    where: { id },
    include: {
      sentences: { orderBy: { index: "asc" } },
      originalAudio: true,
      originalAudioJob: true,
    },
  });

  if (!article) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...article,
    originalAudio: serializeArticleAudio(article.originalAudio, article.originalAudioJob),
  });
}
