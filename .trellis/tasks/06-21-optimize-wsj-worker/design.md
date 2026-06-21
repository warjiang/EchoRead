# Optimize WSJ Worker Pipeline Design

## Architecture

- Keep SQLite/Prisma as the durable queue backend. Extend `ScrapeJob` with the same operational fields used by existing job tables: attempts, maxAttempts, runAfter, lockedAt, and lastError.
- Add a TypeScript worker CLI as the orchestration process. Next.js API routes enqueue work and read status; they do not synchronously contact Python or run downstream jobs in `after()`.
- Keep Python `wsj-worker` responsible for browser/CDP scraping and original-audio processing. Add a synchronous original-audio endpoint alongside the existing callback endpoint so the TS worker can run and ingest audio jobs without routing results through Next.js.

## Data Flow

1. `POST /api/scraper` creates a pending `ScrapeJob` and returns `202`.
2. TS worker claims pending scrape jobs, marks them running, calls Python `/scrape`, and passes the returned articles to the existing scrape ingest service in-process.
3. Scrape ingest creates article/sentence records and enqueues both material and original-audio jobs.
4. TS worker continues processing queues: material jobs run through the existing LLM service; original-audio jobs call Python synchronously, then use the existing original-audio ingest service to update article and sentence audio readiness.
5. UI/API status readers continue to use the existing article, material, original-audio, and scrape job projections.

## Public Interfaces

- Preserve existing API routes and response shapes for `/api/scraper`, `/api/scraper/jobs/:id`, `/api/scraper/ingest`, `/api/materials/worker`, `/api/original-audio/worker`, and `/api/original-audio/ingest`.
- Add package scripts for the standalone worker and debugging:
  - long-running worker loop;
  - one-pass worker run for local checks and cron;
  - stage-level debug commands for scrape, material, original-audio, and end-to-end pipeline verification.
- Add a Python synchronous original-audio route, reusing the current `AudioJobRequest` and `AudioJobCallback` models, while leaving `/audio/jobs` callback behavior intact.

## Reliability

- Claim jobs atomically with `updateMany` status guards, matching existing `MaterialJob` and `ArticleAudioJob` patterns.
- Recover stale scrape locks on worker startup/each polling pass.
- Retry scrape and original-audio failures with bounded attempts and backoff; do not retry unavailable WSJ audio indefinitely.
- Treat downstream job failures independently: a material failure must not prevent original-audio retry, and original-audio failure must not delete article/material data.

## Compatibility

- Docker Compose adds a dedicated TS worker service sharing the same data and public audio volumes as `app`.
- Existing callback routes remain valid for old/manual worker flows, but the documented primary flow becomes the standalone worker process.
- Existing original-audio contracts, public audio paths, coverage thresholds, and sentence clip state semantics remain unchanged.
