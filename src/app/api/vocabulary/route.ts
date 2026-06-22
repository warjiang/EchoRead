import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { createId, db, schema, touch } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { lookupWord } from "@/lib/dictionary";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const words = await db.query.vocabulary.findMany({
    where: eq(schema.vocabulary.userId, user.id),
    orderBy: desc(schema.vocabulary.createdAt),
  });
  return NextResponse.json(words);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { word, context, articleId } = await request.json();

    const definition = await lookupWord(word);
    const defText = definition?.meanings?.[0]?.definitions?.[0]?.definition || null;

    const normalizedWord = String(word).toLowerCase();
    const [vocab] = await db
      .insert(schema.vocabulary)
      .values({
        id: createId("vocab"),
        userId: user.id,
        word: normalizedWord,
        definition: defText,
        context,
        articleId,
        createdAt: touch(),
      })
      .onConflictDoUpdate({
        target: [schema.vocabulary.userId, schema.vocabulary.word],
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
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, mastered } = await request.json();
  const [vocab] = await db
    .update(schema.vocabulary)
    .set({ mastered: Boolean(mastered) })
    .where(and(eq(schema.vocabulary.id, id), eq(schema.vocabulary.userId, user.id)))
    .returning();
  if (!vocab) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(vocab);
}
