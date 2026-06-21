import { loadEnvConfig } from "@next/env";
import { recordWorkerHeartbeat } from "@/lib/admin/pipeline";
import { closeDb } from "@/lib/db";
import { processMaterialJobs } from "@/lib/materials/queue";
import { processArticleAudioJobs } from "@/lib/original-audio/queue";
import { processScrapeJobs } from "@/lib/scraper/worker";

loadEnvConfig(process.cwd());

type WorkerStage = "all" | "scrape" | "materials" | "audio";

interface WorkerOptions {
  workerId: string;
  once: boolean;
  stage: WorkerStage;
  intervalMs: number;
  scrapeLimit: number;
  materialLimit: number;
  audioLimit: number;
}

const DEFAULT_INTERVAL_MS = 30_000;

function readFlag(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) {
    return process.argv[index + 1] || "";
  }

  return null;
}

function readNumberFlag(name: string, fallback: number): number {
  const value = Number(readFlag(name));
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : fallback;
}

function readStage(): WorkerStage {
  const value = readFlag("stage") || process.env.WORKER_STAGE || "all";
  if (value === "all" || value === "scrape" || value === "materials" || value === "audio") {
    return value;
  }
  throw new Error(`Unsupported worker stage: ${value}`);
}

function readOptions(): WorkerOptions {
  return {
    workerId: readFlag("worker-id") || process.env.WORKER_ID || "default",
    once: process.argv.includes("--once") || process.env.WORKER_ONCE === "1",
    stage: readStage(),
    intervalMs: readNumberFlag("interval-ms", Number(process.env.WORKER_INTERVAL_MS || DEFAULT_INTERVAL_MS)),
    scrapeLimit: readNumberFlag("scrape-limit", Number(process.env.WORKER_SCRAPE_LIMIT || 1)),
    materialLimit: readNumberFlag("material-limit", Number(process.env.WORKER_MATERIAL_LIMIT || 2)),
    audioLimit: readNumberFlag("audio-limit", Number(process.env.WORKER_AUDIO_LIMIT || 2)),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasWork(result: { claimed: number }): boolean {
  return result.claimed > 0;
}

async function runOnce(options: WorkerOptions): Promise<boolean> {
  let didWork = false;

  if (options.stage === "all" || options.stage === "scrape") {
    await recordWorkerHeartbeat({
      workerId: options.workerId,
      status: "running",
      stage: "scrape",
      message: "Processing scrape jobs",
    });
    const result = await processScrapeJobs(options.scrapeLimit);
    didWork = hasWork(result) || didWork;
    if (hasWork(result)) {
      console.log("scrape", JSON.stringify(result));
    }
  }

  if (options.stage === "all" || options.stage === "materials") {
    await recordWorkerHeartbeat({
      workerId: options.workerId,
      status: "running",
      stage: "materials",
      message: "Processing material jobs",
    });
    const result = await processMaterialJobs(options.materialLimit);
    didWork = hasWork(result) || didWork;
    if (hasWork(result)) {
      console.log("materials", JSON.stringify(result));
    }
  }

  if (options.stage === "all" || options.stage === "audio") {
    await recordWorkerHeartbeat({
      workerId: options.workerId,
      status: "running",
      stage: "audio",
      message: "Processing original audio jobs",
    });
    const result = await processArticleAudioJobs(options.audioLimit);
    didWork = hasWork(result) || didWork;
    if (hasWork(result)) {
      console.log("audio", JSON.stringify(result));
    }
  }

  return didWork;
}

async function main() {
  const options = readOptions();
  console.log(
    `EchoRead worker starting stage=${options.stage} once=${options.once} intervalMs=${options.intervalMs}`
  );

  let shouldStop = false;
  const stop = () => {
    shouldStop = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    do {
      const didWork = await runOnce(options);
      await recordWorkerHeartbeat({
        workerId: options.workerId,
        status: "idle",
        stage: options.stage,
        message: didWork ? "Worker pass completed with claimed jobs" : "Worker pass completed idle",
      });
      if (options.once || shouldStop) {
        break;
      }
      await sleep(didWork ? 250 : options.intervalMs);
    } while (!shouldStop);
    await recordWorkerHeartbeat({
      workerId: options.workerId,
      status: "stopped",
      stage: options.stage,
      message: "Worker stopped",
    });
  } finally {
    closeDb();
  }
}

main().catch(async (error) => {
  console.error("EchoRead worker failed:", error);
  await recordWorkerHeartbeat({
    workerId: process.env.WORKER_ID || "default",
    status: "failed",
    stage: process.env.WORKER_STAGE || null,
    message: "Worker failed",
    error,
  }).catch(() => undefined);
  closeDb();
  process.exit(1);
});
