# Optimize WSJ worker pipeline

## Goal

Optimize the WSJ worker pipeline so WSJ scraping, article ingestion, training-pack generation, and original-audio processing run as a decoupled, debuggable background workflow instead of depending on a live Next.js request/`after()` chain.

## Requirements

- Decouple WSJ scrape execution from the Next.js service request lifecycle through a durable queue or an equivalent background orchestration mechanism.
- Add a TypeScript CLI worker process as the queue orchestration layer. It will poll Prisma task tables, call the Python `wsj-worker` where browser/audio work is needed, and chain post-scrape processing.
- Use synchronous Python worker responses as the new background-worker main path, then update Prisma directly from the TypeScript worker process. Preserve existing callback APIs for compatibility.
- Preserve the existing deterministic WSJ worker behavior: Python FastAPI worker collects articles through Playwright/CDP, with callback APIs kept for compatibility.
- Make the worker pipeline independently debuggable from the command line and/or standalone worker processes, including local runs against a reachable CDP browser and local callback targets.
- Provide both stage-level debug commands and an end-to-end debug path for scrape -> ingest -> training-package -> original-audio readiness.
- After a scrape job succeeds, automatically complete the shadow-reading material workflow for each article:
  - store article and sentence records;
  - generate or queue the training-package text materials;
  - discover/download original WSJ narration when available;
  - align narration word timings to stored sentence text;
  - cut sentence-level audio clips under the existing public audio paths;
  - update article/sentence readiness state for the shadow-reading page.
- Keep current retry, stale-lock recovery, auth-secret protection, Docker volume sharing, and coverage-threshold behavior unless a design decision explicitly replaces them.
- Do not use LLMs for WSJ scraping itself; LLM use remains limited to training-pack generation.

## Confirmed Current State

- `POST /api/scraper` creates `ScrapeJob` and immediately calls `wsj-worker` over HTTP.
- `wsj-worker` exposes `/jobs`, `/audio/jobs`, and `/scrape`; async jobs use FastAPI `BackgroundTasks` and callbacks to Next.js.
- Scrape ingest currently stores new articles, enqueues `MaterialJob` and `ArticleAudioJob`, then uses Next.js `after()` to opportunistically run both job processors.
- Material generation already uses a DB-backed queue (`MaterialJob`) processed by `POST /api/materials/worker`.
- Original audio already uses a DB-backed queue (`ArticleAudioJob`) processed by `POST /api/original-audio/worker`; the Python worker performs discovery, transcription alignment, and ffmpeg clipping.
- Docker Compose currently starts `chrome`, `wsj-worker`, `app`, and a one-shot `bootstrap-scrape` service.

## Decisions

- Queue/backend mechanism: use SQLite/Prisma task tables with a standalone worker loop; do not add Redis/BullMQ or a Python-side broker for this iteration.
- Worker topology: add a TypeScript CLI worker process for orchestration; keep Python `wsj-worker` focused on Playwright/CDP scraping and original-audio processing.
- Python result flow: TS worker should synchronously call Python worker endpoints and ingest results in-process; existing callback endpoints stay compatible.
- Task shape: keep this as one integrated Trellis task with staged implementation and validation; do not create child tasks unless implementation reveals a blocker.
- Debugging scope: support both stage-level commands and an end-to-end run; do not limit debugging to scraper-only checks.

## Acceptance Criteria

- [ ] Creating a scrape job returns quickly and does not require Next.js to synchronously contact the Python worker.
- [ ] A background worker can pick pending scrape jobs, run WSJ collection, ingest results, and continue downstream material/audio work.
- [ ] The full post-scrape workflow can complete without relying on Next.js `after()`.
- [ ] A developer can run and debug the worker pipeline locally with documented commands and clear environment variables.
- [ ] Existing scrape, material, and original-audio API contracts remain compatible for the UI and current Docker deployment unless the design names a migration.
- [ ] Automated tests cover queue-state transitions, worker URL/dispatch behavior, and original-audio/material chaining.

## Notes

- Relevant contract: `.trellis/spec/frontend/original-audio-contracts.md`.
