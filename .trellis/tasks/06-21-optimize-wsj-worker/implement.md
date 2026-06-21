# Optimize WSJ Worker Pipeline Implementation Plan

## Preparation

- Read `.trellis/spec/frontend/original-audio-contracts.md` before code edits and keep its DB/API/worker contracts intact.
- Inspect current queue patterns in `src/lib/materials/queue.ts` and `src/lib/original-audio/queue.ts`; reuse their stale-lock, retry, and claim style.

## Implementation Steps

1. Add a Prisma migration extending `ScrapeJob` with attempts, maxAttempts, runAfter, lockedAt, and lastError. Keep existing fields and API serialization compatible.
2. Refactor scraper queue code so `POST /api/scraper` only creates/enqueues a pending job. Move worker contact into a new `processScrapeJobs` service that claims jobs, calls Python `/scrape`, ingests results, and retries/fails jobs consistently.
3. Add the TS worker CLI with long-running and one-pass modes. It should process scrape, material, and original-audio queues in a deterministic order with configurable limits and poll interval.
4. Remove Next.js `after()` dependency from scrape ingest, material regenerate, and original-audio retry paths. These routes should enqueue state only; the TS worker should perform background execution.
5. Add a synchronous Python original-audio endpoint that reuses `process_audio_job` and returns `AudioJobCallback`. Update the TS original-audio worker path to use it and call `ingestArticleAudioUpdate` in-process, while preserving the callback endpoint path.
6. Add stage-level debug commands and docs for local CDP, local worker URLs, one-pass queue processing, single scrape debug, single audio debug, material debug, and end-to-end pipeline verification.
7. Update Docker Compose files to run the TS worker service with shared `data` and `public/audio` volumes, the same relevant env vars as `app`, and dependencies on app health plus Python worker/chrome health where needed.

## Validation

- Run existing tests: `pnpm test:scraper`, `pnpm test:materials`, `pnpm test:original-audio`, and Python worker tests from `worker/wsj-worker`.
- Add tests for scrape queue normalization/state transitions and ensure `POST /api/scraper` no longer synchronously calls Python.
- Add Python tests for the synchronous original-audio route/model path without invoking Whisper/ffmpeg directly.
- Manually verify a one-pass worker run can process a queued scrape job and that article status, training package status, and original-audio status move forward without using Next.js `after()`.

## Rollback Points

- If synchronous original-audio processing is unstable, keep `/audio/jobs` callback mode as a fallback behind a worker option while preserving the new scrape queue decoupling.
- If Docker worker startup ordering is flaky, keep the worker service restartable and document manual `worker:once` recovery while preserving durable pending jobs.
