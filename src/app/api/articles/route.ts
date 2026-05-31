import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const articles = await prisma.article.findMany({
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      title: true,
      category: true,
      difficulty: true,
      publishedAt: true,
      summary: true,
    },
    take: 20,
  });
  return NextResponse.json(articles);
}
