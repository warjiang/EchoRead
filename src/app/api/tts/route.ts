import { NextRequest, NextResponse } from "next/server";
import { asc, and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isAuthorizedByBearer } from "@/lib/api-auth";
import { generateAudio } from "@/lib/tts/edge-tts";

export async function POST(request: NextRequest) {
  try {
    const { sentenceId, voice, rate } = await request.json();

    const sentence = await db.query.sentences.findFirst({ where: eq(schema.sentences.id, sentenceId) });

    if (!sentence) {
      return NextResponse.json({ error: "Sentence not found" }, { status: 404 });
    }

    if (sentence.audioUrl) {
      return NextResponse.json({ audioUrl: sentence.audioUrl });
    }

    const filename = `${sentence.articleId}_${sentence.id}`;
    const audioUrl = await generateAudio(sentence.text, filename, {
      voice: voice || "en-US-AriaNeural",
      rate: rate || "+0%",
    });

    await db.update(schema.sentences).set({ audioUrl }).where(eq(schema.sentences.id, sentenceId)).run();

    return NextResponse.json({ audioUrl });
  } catch (error) {
    console.error("TTS error:", error);
    return NextResponse.json({ error: "Failed to generate audio" }, { status: 500 });
  }
}

// Batch generate audio for all sentences in an article
export async function PUT(request: NextRequest) {
  if (!isAuthorizedByBearer(request, "MATERIAL_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { articleId, voice, rate } = await request.json();

    const sentences = await db.query.sentences.findMany({
      where: and(eq(schema.sentences.articleId, articleId), isNull(schema.sentences.audioUrl)),
      orderBy: asc(schema.sentences.index),
    });

    const results = [];
    for (const sentence of sentences) {
      const filename = `${articleId}_${sentence.id}`;
      try {
        const audioUrl = await generateAudio(sentence.text, filename, {
          voice: voice || "en-US-AriaNeural",
          rate: rate || "+0%",
        });
        await db.update(schema.sentences).set({ audioUrl }).where(eq(schema.sentences.id, sentence.id)).run();
        results.push({ id: sentence.id, audioUrl });
      } catch {
        results.push({ id: sentence.id, error: "Failed" });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Batch TTS error:", error);
    return NextResponse.json({ error: "Failed to batch generate audio" }, { status: 500 });
  }
}
