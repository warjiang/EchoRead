import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function GET() {
  const articles = await db.query.articles.findMany({
    orderBy: desc(schema.articles.publishedAt),
    columns: {
      id: true,
      title: true,
      category: true,
      difficulty: true,
      publishedAt: true,
      summary: true,
    },
    limit: 20,
  });
  return NextResponse.json(articles);
}
