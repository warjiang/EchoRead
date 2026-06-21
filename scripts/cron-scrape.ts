/**
 * Cron script to start an async WSJ scrape job.
 * Run with: npx tsx scripts/cron-scrape.ts
 * Or set up as a cron job: 0 8 * * * cd /path/to/project && npx tsx scripts/cron-scrape.ts
 */

import { prisma } from "../src/lib/db";
import {
  createAndStartScrapeJob,
  normalizeMaxArticles,
  toScrapeJobApi,
} from "../src/lib/scraper/worker";

async function main() {
  const maxArticles = normalizeMaxArticles(Number(process.env.WSJ_MAX_ARTICLES || 5));
  console.log(`[${new Date().toISOString()}] Starting async WSJ scrape job...`);

  try {
    const result = await createAndStartScrapeJob(maxArticles);
    console.log(JSON.stringify(toScrapeJobApi(result.job), null, 2));

    if (!result.accepted) {
      console.error(`Worker rejected scrape job: ${result.error || "unknown error"}`);
      process.exit(1);
    }

    console.log("Scrape job accepted. Check /api/scraper/jobs/:id for status.");
  } catch (error) {
    console.error("Failed to start scrape job:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
