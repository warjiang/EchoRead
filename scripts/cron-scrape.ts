/**
 * Cron script to scrape WSJ articles daily.
 * Run with: npx tsx scripts/cron-scrape.ts
 * Or set up as a cron job: 0 8 * * * cd /path/to/project && npx tsx scripts/cron-scrape.ts
 */

import { PrismaClient } from "@prisma/client";
import { scrapeWSJArticles } from "../src/lib/scraper/wsj";
import { splitIntoSentences } from "../src/lib/nlp/sentence-split";

const prisma = new PrismaClient();

async function main() {
  console.log(`[${new Date().toISOString()}] Starting WSJ article scrape...`);

  try {
    const articles = await scrapeWSJArticles(5);
    console.log(`Found ${articles.length} articles`);

    let created = 0;
    for (const article of articles) {
      const existing = await prisma.article.findUnique({
        where: { url: article.url },
      });
      if (existing) {
        console.log(`  Skipping (exists): ${article.title.slice(0, 50)}...`);
        continue;
      }

      const sentences = splitIntoSentences(article.content);

      await prisma.article.create({
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
      created++;
      console.log(`  Created: ${article.title.slice(0, 50)}... (${sentences.length} sentences)`);
    }

    console.log(`Done! Created ${created} new articles.`);
  } catch (error) {
    console.error("Scrape failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
