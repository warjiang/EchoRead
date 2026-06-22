import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { serializeArticleAudio } from "@/lib/original-audio/queue";
import { serializeSentenceForArticleApi } from "@/lib/original-audio/lyric";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const article = await db.query.articles.findFirst({
    where: eq(schema.articles.id, id),
  });

  if (!article) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [sentences, originalAudio, originalAudioJob] = await Promise.all([
    db.query.sentences.findMany({
      where: eq(schema.sentences.articleId, id),
      orderBy: asc(schema.sentences.index),
    }),
    db.query.articleAudio.findFirst({ where: eq(schema.articleAudio.articleId, id) }),
    db.query.articleAudioJobs.findFirst({ where: eq(schema.articleAudioJobs.articleId, id) }),
  ]);

  return NextResponse.json({
    ...article,
    sentences: sentences.map(serializeSentenceForArticleApi),
    originalAudio: serializeArticleAudio(originalAudio, originalAudioJob),
  });
}
