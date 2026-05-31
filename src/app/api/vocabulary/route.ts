import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { lookupWord } from "@/lib/dictionary";

export async function GET() {
  const words = await prisma.vocabulary.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(words);
}

export async function POST(request: NextRequest) {
  try {
    const { word, context, articleId } = await request.json();

    const definition = await lookupWord(word);
    const defText = definition?.meanings?.[0]?.definitions?.[0]?.definition || null;

    const vocab = await prisma.vocabulary.upsert({
      where: { word: word.toLowerCase() },
      update: { context, articleId },
      create: {
        word: word.toLowerCase(),
        definition: defText,
        context,
        articleId,
      },
    });

    return NextResponse.json(vocab);
  } catch (error) {
    console.error("Vocabulary error:", error);
    return NextResponse.json({ error: "Failed to save word" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const { id, mastered } = await request.json();
  const vocab = await prisma.vocabulary.update({
    where: { id },
    data: { mastered },
  });
  return NextResponse.json(vocab);
}
