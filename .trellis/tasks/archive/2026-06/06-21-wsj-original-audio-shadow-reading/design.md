# Use WSJ Original Audio for Shadow Reading - Design

## Summary

Add an original-audio pipeline that runs after article ingestion. The existing Python `wsj-worker` discovers and downloads WSJ article narration through the authenticated browser session, aligns that source audio to stored article sentences, writes full source audio and per-sentence clips under `public/audio`, and reports state back to the Next.js app. The Next.js app owns persistence, retries, APIs, and UI state.

## Architecture

### Existing Flow

1. Next.js creates a `ScrapeJob`.
2. `wsj-worker` collects article text and posts scrape results back to `/api/scraper/ingest`.
3. Next.js creates `Article` and `Sentence` records.
4. Shadow reading currently calls `/api/tts` for missing sentence `audioUrl` values.

### Target Flow

1. Next.js ingests a new article and its sentences.
2. Next.js creates or enqueues an original-audio job for that article.
3. A background server step starts a worker audio job by calling `wsj-worker`.
4. `wsj-worker` uses the authenticated WSJ browser context to discover source audio.
5. If source audio is found, the worker downloads the full file into `public/audio/wsj-source`.
6. The worker derives sentence timings from publisher metadata when available, otherwise from worker-local transcription/alignment.
7. The worker cuts per-sentence clips into `public/audio/wsj-clips/<articleId>/`.
8. The worker posts a callback with source metadata, clip URLs, coverage, and status.
9. Next.js updates original-audio state and sentence clip fields.
10. Article pages show ready, processing, unavailable, or failed state. Shadow reading opens only when coverage meets the configured threshold.

## Persistence

Add an article-level original-audio result model:

```prisma
model ArticleAudio {
  id              String   @id @default(cuid())
  articleId       String   @unique
  status          String   @default("pending")
  sourceUrl       String?
  sourceAudioUrl  String?
  sourcePath      String?
  durationMs      Int?
  coverageRatio   Float?
  sentenceCount   Int      @default(0)
  clippedCount    Int      @default(0)
  lastError       String?
  startedAt       DateTime?
  finishedAt      DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  article         Article  @relation(fields: [articleId], references: [id], onDelete: Cascade)
}
```

Add a queue/job model for attempts and retries:

```prisma
model ArticleAudioJob {
  id             String   @id @default(cuid())
  articleId      String   @unique
  status         String   @default("pending")
  attempts       Int      @default(0)
  maxAttempts    Int      @default(3)
  timeoutSeconds Int      @default(300)
  runAfter       DateTime @default(now())
  lockedAt       DateTime?
  workerJobId    String?
  lastError      String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  article        Article  @relation(fields: [articleId], references: [id], onDelete: Cascade)

  @@index([status, runAfter])
}
```

Add sentence-level original clip fields instead of overloading current TTS-oriented `audioUrl`:

```prisma
model Sentence {
  wsjAudioUrl     String?
  wsjAudioStartMs Int?
  wsjAudioEndMs   Int?
  wsjAudioStatus  String @default("pending")
}
```

`Sentence.audioUrl` can remain for legacy data and the existing TTS endpoint, but the shadow-reading flow for this task must use `wsjAudioUrl` and must not request `/api/tts`.

## Status Model

Article-level audio statuses:

- `pending`: job exists but has not started.
- `processing`: worker accepted or is running the attempt.
- `ready`: coverage meets the configured threshold.
- `unavailable`: authenticated page has no accessible WSJ narration.
- `failed`: retry budget exhausted or manual attempt failed.

Sentence-level audio statuses:

- `pending`: not processed yet.
- `ready`: `wsjAudioUrl` is playable.
- `unavailable`: no aligned clip for this sentence.
- `failed`: clipping or alignment failed for this sentence.

Readiness rule:

- Default `ORIGINAL_AUDIO_MIN_COVERAGE=0.9`.
- `ArticleAudio.status` becomes `ready` only when `clippedCount / sentenceCount >= threshold`.
- Unavailable sentences are shown in the practice list and skipped by autoplay.

## Worker Contract

Add a worker endpoint:

```http
POST /audio/jobs
Authorization: Bearer <SCRAPER_WORKER_SECRET>
```

Request:

```json
{
  "jobId": "audio_job_id",
  "articleId": "article_id",
  "articleUrl": "https://www.wsj.com/articles/...",
  "title": "Article title",
  "sentences": [
    { "id": "sentence_id", "index": 0, "text": "Sentence text." }
  ],
  "callbackUrl": "http://app:3000/api/original-audio/ingest",
  "callbackSecret": "secret",
  "timeoutSeconds": 300,
  "coverageThreshold": 0.9
}
```

Accepted response:

```json
{ "jobId": "audio_job_id", "status": "accepted" }
```

Callbacks:

```json
{
  "jobId": "audio_job_id",
  "articleId": "article_id",
  "status": "running"
}
```

```json
{
  "jobId": "audio_job_id",
  "articleId": "article_id",
  "status": "succeeded",
  "sourceUrl": "https://...",
  "sourceAudioUrl": "/audio/wsj-source/article_id.mp3",
  "sourcePath": "/app/public/audio/wsj-source/article_id.mp3",
  "durationMs": 425000,
  "coverageRatio": 0.94,
  "clips": [
    {
      "sentenceId": "sentence_id",
      "audioUrl": "/audio/wsj-clips/article_id/sentence_id.mp3",
      "startMs": 1230,
      "endMs": 4890,
      "status": "ready"
    }
  ]
}
```

```json
{
  "jobId": "audio_job_id",
  "articleId": "article_id",
  "status": "unavailable",
  "errorMessage": "No accessible WSJ article audio found"
}
```

```json
{
  "jobId": "audio_job_id",
  "articleId": "article_id",
  "status": "failed",
  "errorMessage": "Timed out after 300 seconds"
}
```

## Worker Processing

### Discovery

The worker opens the article in the authenticated browser context and attempts, in order:

1. Extract publisher-provided audio/transcript/timing data from page scripts and player configuration.
2. Observe network responses during page/player initialization for audio media or audio metadata.
3. Inspect DOM audio/player elements and associated data attributes.

The worker must not attempt to bypass login, subscription, DRM, or access controls. If no accessible source exists, it returns `unavailable`.

### Download

The worker downloads source audio using the authenticated browser context or captured response body so session cookies and headers match the user's WSJ access. It writes the full source file to:

```text
public/audio/wsj-source/<articleId>.<ext>
```

The `wsj-worker` container must mount the same host `./public/audio` volume as the app container, likely at `/app/public/audio`, and expose that as `AUDIO_PUBLIC_DIR`.

### Alignment

Preferred order:

1. Use publisher-provided transcript or timed metadata when available.
2. Fall back to worker-local transcription/alignment.

MVP implementation should use an adapter boundary inside `wsj-worker`, for example:

```python
class AudioAligner:
    async def align(self, source_path: Path, sentences: list[SentenceInput]) -> list[SentenceClipTiming]:
        ...
```

The initial implementation can start with a local transcription adapter and `ffmpeg` clipping. If empirical validation shows WSJ pages include reliable timings, the publisher-metadata adapter can produce timings without transcription.

### Clipping

The worker creates per-sentence clips under:

```text
public/audio/wsj-clips/<articleId>/<sentenceId>.mp3
```

Clip URLs returned to Next.js should be browser paths:

```text
/audio/wsj-clips/<articleId>/<sentenceId>.mp3
```

Clips should include small configurable padding around sentence boundaries if alignment quality requires it.

## Next.js APIs

Add an authenticated ingest endpoint for worker callbacks:

```text
POST /api/original-audio/ingest
```

It validates the bearer token with `SCRAPER_WORKER_SECRET`, updates `ArticleAudio`, `ArticleAudioJob`, and `Sentence` rows, and never throws in a way that breaks article reading.

Add a manual retry endpoint:

```text
POST /api/articles/:id/original-audio/retry
```

Request:

```json
{ "timeoutSeconds": 600 }
```

The endpoint resets or creates the audio job, applies the custom timeout to the next attempt, marks the audio result as `pending`, and triggers worker processing.

Article detail API and page queries should include article audio status and sentence `wsjAudioUrl`/status fields.

## Frontend Behavior

Article page:

- Always renders article text.
- Shows original-audio status near the shadow-reading action.
- Enables "Start Shadow Reading" only when `ArticleAudio.status === "ready"`.
- Shows processing/unavailable/failed states otherwise.
- Shows a lightweight developer/admin retry control when status is `failed`; the control accepts a custom timeout in seconds.

Shadow page:

- Loads article, article audio status, and sentences.
- If article audio is not ready, shows a non-practice state and links back to article.
- Uses `wsjAudioUrl` for playback.
- Does not call `/api/tts`.
- Shows unavailable sentences and skips them during autoplay and next/previous flows.

## Compatibility

- Existing `Sentence.audioUrl` and `/api/tts` can remain for now, but this feature stops using them for shadow reading.
- Existing scrape ingestion must not fail if audio job creation fails; audio failures are recorded separately.
- Existing training-package jobs continue to enqueue independently from audio jobs.
- Old articles can remain without `ArticleAudio` until manually retried or a backfill is added later.

## Configuration

Add environment variables:

```text
ORIGINAL_AUDIO_MIN_COVERAGE=0.9
ORIGINAL_AUDIO_MAX_ATTEMPTS=3
ORIGINAL_AUDIO_TIMEOUT_SECONDS=300
ORIGINAL_AUDIO_WORKER_URL=http://wsj-worker:8000/audio/jobs
AUDIO_PUBLIC_DIR=/app/public/audio
```

Docker Compose must mount `./public/audio:/app/public/audio` into `wsj-worker` as well as `app`.

## Failure And Retry

- Automatic attempts retry transient failures up to `ORIGINAL_AUDIO_MAX_ATTEMPTS`.
- Confirmed no-audio cases become `unavailable` and do not repeatedly retry.
- Timeout failures count as transient failures.
- Once attempts are exhausted, status becomes `failed`.
- Manual retry can run from the article page or API with a custom timeout. Manual retry resets the job to `pending` and applies the supplied timeout for the next attempt.

## Rollback

- Disable automatic queue triggering while leaving article scraping intact.
- Hide or disable the original-audio status UI.
- Existing article reading and training-package generation remain functional.
- Since new fields are additive, old flows remain available during rollback.
