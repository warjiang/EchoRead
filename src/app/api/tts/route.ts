import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateAudio } from "@/lib/tts/edge-tts";

export async function POST(request: NextRequest) {
  try {
    const { sentenceId, voice, rate } = await request.json();

    const sentence = await prisma.sentence.findUnique({
      where: { id: sentenceId },
    });

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

    await prisma.sentence.update({
      where: { id: sentenceId },
      data: { audioUrl },
    });

    return NextResponse.json({ audioUrl });
  } catch (error) {
    console.error("TTS error:", error);
    return NextResponse.json({ error: "Failed to generate audio" }, { status: 500 });
  }
}

// Batch generate audio for all sentences in an article
export async function PUT(request: NextRequest) {
  try {
    const { articleId, voice, rate } = await request.json();

    const sentences = await prisma.sentence.findMany({
      where: { articleId, audioUrl: null },
      orderBy: { index: "asc" },
    });

    const results = [];
    for (const sentence of sentences) {
      const filename = `${articleId}_${sentence.id}`;
      try {
        const audioUrl = await generateAudio(sentence.text, filename, {
          voice: voice || "en-US-AriaNeural",
          rate: rate || "+0%",
        });
        await prisma.sentence.update({
          where: { id: sentence.id },
          data: { audioUrl },
        });
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
