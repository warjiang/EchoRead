import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorizedByBearer } from "@/lib/api-auth";
import { scrapeWSJArticlesWithWorker } from "@/lib/scraper/worker";
import { splitIntoSentences } from "@/lib/nlp/sentence-split";
import { enqueueMaterialJob, processMaterialJobs } from "@/lib/materials/queue";

async function runScrape(request: NextRequest) {
  if (!isAuthorizedByBearer(request, "SCRAPER_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const articles = await scrapeWSJArticlesWithWorker(5);
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
      await enqueueMaterialJob(dbArticle.id);
    }

    if (created.length > 0) {
      after(async () => {
        try {
          await processMaterialJobs(Math.min(created.length, 3));
        } catch (error) {
          console.error("Background material worker failed:", error);
        }
      });
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

export async function POST(request: NextRequest) {
  return runScrape(request);
}
