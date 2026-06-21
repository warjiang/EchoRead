import { loadEnvConfig } from "@next/env";
import { count, inArray, isNotNull } from "drizzle-orm";
import * as fs from "fs/promises";
import * as path from "path";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { closeDb, db, schema } from "../src/lib/db";

loadEnvConfig(process.cwd());

interface Options {
  dryRun: boolean;
  keepAudio: boolean;
  includeVocabulary: boolean;
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".webm"]);

function parseOptions(argv: string[]): Options {
  const flags = new Set(argv);
  if (flags.has("--help") || flags.has("-h")) {
    console.log(`
Usage:
  pnpm cleanup:scraped -- --yes
  pnpm cleanup:scraped -- --dry-run

Options:
  --yes                 Actually delete scraped data. Without this, the script only previews.
  --dry-run             Preview counts and files without deleting anything.
  --keep-audio          Leave generated files under public/audio untouched.
  --include-vocabulary  Delete vocabulary rows too. By default vocabulary is preserved and detached from articles.
`);
    process.exit(0);
  }

  return {
    dryRun: !flags.has("--yes") || flags.has("--dry-run"),
    keepAudio: flags.has("--keep-audio"),
    includeVocabulary: flags.has("--include-vocabulary"),
  };
}

async function countRootAudioFiles(audioDir: string): Promise<number> {
  try {
    const entries = await fs.readdir(audioDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function countFiles(target: string): Promise<number> {
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) {
        total += await countFiles(child);
      } else if (entry.isFile()) {
        total += 1;
      }
    }
    return total;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function removeRootAudioFiles(audioDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(audioDir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => fs.rm(path.join(audioDir, entry.name), { force: true }))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function removeGeneratedAudio(audioDir: string, dryRun: boolean): Promise<Record<string, number>> {
  const sourceDir = path.join(audioDir, "wsj-source");
  const clipsDir = path.join(audioDir, "wsj-clips");
  const counts = {
    rootAudioFiles: await countRootAudioFiles(audioDir),
    wsjSourceFiles: await countFiles(sourceDir),
    wsjClipFiles: await countFiles(clipsDir),
  };

  if (!dryRun) {
    await removeRootAudioFiles(audioDir);
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(clipsDir, { recursive: true, force: true });
    await fs.mkdir(audioDir, { recursive: true });
  }

  return counts;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const audioDir = path.resolve(process.env.AUDIO_PUBLIC_DIR || path.join(process.cwd(), "public", "audio"));
  const articleIds = await db.query.articles.findMany({ columns: { id: true } });
  const articleIdValues = articleIds.map((article) => article.id);
  const countRows = async (table: SQLiteTable) => {
    const [row] = await db.select({ value: count() }).from(table);
    return row?.value ?? 0;
  };

  const counts = {
    articles: articleIds.length,
    sentences: await countRows(schema.sentences),
    scrapeJobs: await countRows(schema.scrapeJobs),
    readingHistory: await countRows(schema.readingHistory),
    trainingPackages: await countRows(schema.trainingPackages),
    materialJobs: await countRows(schema.materialJobs),
    articleAudio: await countRows(schema.articleAudio),
    articleAudioJobs: await countRows(schema.articleAudioJobs),
    vocabulary: await countRows(schema.vocabulary),
    linkedVocabulary: (await db.select({ value: count() }).from(schema.vocabulary).where(isNotNull(schema.vocabulary.articleId)))[0]?.value ?? 0,
  };
  const audioCounts = options.keepAudio ? null : await removeGeneratedAudio(audioDir, true);

  console.log("Cleanup target summary:");
  console.table(counts);
  if (audioCounts) {
    console.log(`Audio directory: ${audioDir}`);
    console.table(audioCounts);
  } else {
    console.log("Audio cleanup: skipped by --keep-audio");
  }

  if (options.dryRun) {
    console.log("Dry run only. Re-run with `pnpm cleanup:scraped -- --yes` to delete these records/files.");
    return;
  }

  db.transaction((tx) => {
    tx.delete(schema.articleAudioJobs).run();
    tx.delete(schema.articleAudio).run();
    tx.delete(schema.materialJobs).run();
    tx.delete(schema.trainingPackages).run();
    tx.delete(schema.readingHistory).run();
    tx.delete(schema.sentences).run();
    if (options.includeVocabulary) {
      tx.delete(schema.vocabulary).run();
    } else if (articleIdValues.length > 0) {
      tx.update(schema.vocabulary)
        .set({ articleId: null })
        .where(inArray(schema.vocabulary.articleId, articleIdValues))
        .run();
    } else {
      tx.update(schema.vocabulary)
        .set({ articleId: null })
        .where(isNotNull(schema.vocabulary.articleId))
        .run();
    }
    tx.delete(schema.articles).run();
    tx.delete(schema.scrapeJobs).run();
  });

  if (!options.keepAudio) {
    await removeGeneratedAudio(audioDir, false);
  }

  console.log("Scraped article data cleaned.");
  if (!options.includeVocabulary) {
    console.log("Vocabulary rows were preserved; linked articleId values were cleared.");
  }
}

main()
  .catch((error) => {
    console.error("Failed to clean scraped data:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    closeDb();
  });
