import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { createId, db, schema, touch } from "@/lib/db";
import { lookupWord } from "@/lib/dictionary";

export async function GET() {
  const words = await db.query.vocabulary.findMany({
    orderBy: desc(schema.vocabulary.createdAt),
  });
  return NextResponse.json(words);
}

export async function POST(request: NextRequest) {
  try {
    const { word, context, articleId } = await request.json();

    const definition = await lookupWord(word);
    const defText = definition?.meanings?.[0]?.definitions?.[0]?.definition || null;

    const normalizedWord = String(word).toLowerCase();
    const [vocab] = await db
      .insert(schema.vocabulary)
      .values({
        id: createId("vocab"),
        word: normalizedWord,
        definition: defText,
        context,
        articleId,
        createdAt: touch(),
      })
      .onConflictDoUpdate({
        target: schema.vocabulary.word,
        set: { context, articleId },
      })
      .returning();

    return NextResponse.json(vocab);
  } catch (error) {
    console.error("Vocabulary error:", error);
    return NextResponse.json({ error: "Failed to save word" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const { id, mastered } = await request.json();
  const [vocab] = await db
    .update(schema.vocabulary)
    .set({ mastered: Boolean(mastered) })
    .where(eq(schema.vocabulary.id, id))
    .returning();
  return NextResponse.json(vocab);
}
