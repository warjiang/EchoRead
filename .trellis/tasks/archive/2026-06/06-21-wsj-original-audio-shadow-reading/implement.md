# Use WSJ Original Audio for Shadow Reading - Implementation Plan

## Preconditions

- Review `prd.md` and `design.md`.
- Keep work in the active Trellis task until the user approves implementation.
- Before editing source code, load `trellis-before-dev` and the relevant frontend specs.

## Implementation Checklist

### 1. Schema And Persistence

- Add Prisma models for `ArticleAudio` and `ArticleAudioJob`.
- Add sentence-level WSJ audio fields: `wsjAudioUrl`, `wsjAudioStartMs`, `wsjAudioEndMs`, and `wsjAudioStatus`.
- Add article relations for original-audio state and jobs.
- Create and apply a Prisma migration.
- Generate Prisma client.

### 2. Next.js Original-Audio Queue

- Add a server module under `src/lib/original-audio/` for queue operations.
- Add helpers for:
  - normalizing timeout seconds
  - reading retry/coverage env vars
  - creating an audio job after article creation
  - starting worker jobs
  - ingesting worker callbacks
  - serializing article-audio state for APIs
- Update article creation in `src/lib/scraper/jobs.ts` to enqueue original-audio processing after creating a new article.
- Keep audio job failures isolated from scrape ingestion.

### 3. Next.js API Endpoints

- Add `POST /api/original-audio/ingest` for worker callbacks.
- Add `POST /api/articles/:id/original-audio/retry` for manual retry with custom `timeoutSeconds`.
- Update article APIs to include original-audio state and sentence WSJ clip fields.
- Ensure bearer-protected endpoints use existing auth helpers and secrets.

### 4. Python Worker Audio Endpoint

- Add Pydantic request/response/callback models for `/audio/jobs`.
- Add `POST /audio/jobs` that accepts work and runs it in FastAPI background tasks.
- Reuse the authenticated Playwright context for audio discovery and download.
- Add a timeout wrapper around each attempt.
- Post `running`, `succeeded`, `unavailable`, or `failed` callbacks to Next.js.

### 5. Worker Audio Pipeline

- Add audio discovery helpers:
  - page metadata/script extraction
  - player DOM inspection
  - network response observation
- Add authenticated source audio download into `AUDIO_PUBLIC_DIR/wsj-source`.
- Add an alignment adapter boundary.
- Implement publisher-timing adapter when reliable metadata is found.
- Implement local transcription/alignment fallback behind the same adapter.
- Add `ffmpeg` clipping into `AUDIO_PUBLIC_DIR/wsj-clips/<articleId>/`.
- Return per-sentence clip metadata and coverage.

### 6. Docker And Environment

- Add `AUDIO_PUBLIC_DIR` and original-audio env vars to `.env.example`.
- Mount `./public/audio:/app/public/audio` into `wsj-worker` in local and deploy Compose files.
- Add worker dependencies in `worker/wsj-worker/pyproject.toml`.
- Refresh `uv.lock` after dependency changes.
- Ensure `ffmpeg` is available in the worker image.

### 7. Frontend Article Page

- Add an original-audio status panel or compact control near the shadow-reading button.
- Disable or replace "Start Shadow Reading" until audio status is `ready`.
- Show processing, unavailable, and failed messages.
- Add developer/admin retry control for failed state with custom timeout seconds.

### 8. Frontend Shadow Page And Player

- Remove the "Generate All Audio" TTS action from the shadow page.
- Ensure `SentencePlayer` plays `wsjAudioUrl` only.
- Prevent `/api/tts` calls from the shadow-reading flow.
- Mark unavailable sentences and skip them in autoplay.
- Handle a not-ready article state before rendering practice controls.

### 9. Tests

- Add Next.js unit tests for:
  - timeout normalization
  - coverage readiness
  - callback ingest states
  - retry reset with custom timeout
  - no TTS source selection in shadow playback data
- Add Python worker tests for:
  - audio URL discovery from mock page snapshots
  - unavailable when no audio exists
  - callback payload shape
  - timeout/failure status mapping
- Update existing scraper tests if article creation now enqueues audio jobs.

### 10. Documentation

- Update README with:
  - original-audio pipeline
  - environment variables
  - storage paths
  - local-use boundary
  - manual retry behavior
- Document that WSJ original audio availability varies by article.

## Validation Commands

Run after implementation:

```bash
pnpm lint
pnpm test:scraper
pnpm test:materials
cd worker/wsj-worker && uv run python -m unittest discover -s tests
```

Also run a local smoke test:

```bash
docker compose up --build
```

Manual smoke criteria:

- Fetch new articles.
- Confirm article pages remain readable while audio is pending or unavailable.
- Confirm a ready article opens shadow reading with WSJ clip URLs.
- Confirm shadow reading does not call `/api/tts`.
- Force a failed audio job and retry it from the article page with a larger timeout.

## Risky Areas

- WSJ article audio discovery may vary by page type.
- Local transcription/alignment can be slow and may need model-size tuning.
- Worker and app containers must share the same audio volume.
- Old TTS-generated `Sentence.audioUrl` values must not accidentally count as ready WSJ audio.
- Long-running worker tasks must not block scrape callback ingestion.

## Rollback Points

- After schema migration: rollback by ignoring new models/fields in application code.
- After queue integration: disable enqueueing original-audio jobs.
- After frontend integration: hide original-audio controls and leave article reading intact.
- After worker integration: keep `/audio/jobs` unused while preserving scrape `/jobs`.

## Review Gate Before Start

- User confirms PRD/design/implementation scope.
- Any remaining dependency choice is resolved or accepted as an implementation spike inside the worker adapter.
- Then run `python3 ./.trellis/scripts/task.py start 06-21-wsj-original-audio-shadow-reading`.
