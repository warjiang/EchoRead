/**
 * Cron script to enqueue an async WSJ scrape job.
 * Run with: npx tsx scripts/cron-scrape.ts
 * Or set up as a cron job: 0 8 * * * cd /path/to/project && npx tsx scripts/cron-scrape.ts
 */

import { closeDb } from "../src/lib/db";
import {
  createScrapeJob,
  normalizeMaxArticles,
  toScrapeJobApi,
} from "../src/lib/scraper/worker";

async function main() {
  const maxArticles = normalizeMaxArticles(Number(process.env.WSJ_MAX_ARTICLES || 5));
  console.log(`[${new Date().toISOString()}] Queueing async WSJ scrape job...`);

  try {
    const result = await createScrapeJob(maxArticles);
    console.log(JSON.stringify(toScrapeJobApi(result.job), null, 2));

    if (!result.accepted) {
      console.error(`Failed to queue scrape job: ${result.error || "unknown error"}`);
      process.exit(1);
    }

    console.log("Scrape job queued. Run `pnpm worker:once` or the long-running worker to process it.");
  } catch (error) {
    console.error("Failed to start scrape job:", error);
    process.exit(1);
  } finally {
    closeDb();
  }
}

main();
