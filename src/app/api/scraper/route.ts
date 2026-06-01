import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scrapeWSJArticles } from "@/lib/scraper/wsj";
import { splitIntoSentences } from "@/lib/nlp/sentence-split";

async function runScrape() {
  try {
    const articles = await scrapeWSJArticles(5);
    const created = [];

    for (const article of articles) {
      const existing = await prisma.article.findUnique({
        where: { url: article.url },
      });
      if (existing) continue;

      const sentences = splitIntoSentences(article.content);

      const dbArticle = await prisma.article.create({
        data: {
          title: article.title,
          url: article.url,
          content: article.content,
          category: article.category,
          publishedAt: article.publishedAt,
          sentences: {
            create: sentences.map((text, index) => ({
              text,
              index,
            })),
          },
        },
      });
      created.push(dbArticle);
    }

    return NextResponse.json({
      message: `Scraped ${created.length} new articles`,
      articles: created,
    });
  } catch (error) {
    console.error("Scraper error:", error);
    return NextResponse.json(
      { error: "Failed to scrape articles" },
      { status: 500 }
    );
  }
}

export async function POST() {
  return runScrape();
}

export async function GET() {
  return runScrape();
}
