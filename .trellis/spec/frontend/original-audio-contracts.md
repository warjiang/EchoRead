# Original Audio Contracts

## Scenario: WSJ Original Audio Shadow Reading

### 1. Scope / Trigger

- Trigger: Original-audio processing crosses database schema, Next.js APIs, Python worker callbacks, Docker volumes, environment variables, and frontend playback.
- Applies when changing WSJ original audio discovery, article audio state, sentence clip fields, retry behavior, or shadow-reading playback source selection.

### 2. Signatures

- DB:
  - `ArticleAudio.articleId` is unique and owns article-level original-audio state.
  - `ArticleAudioJob.articleId` is unique and owns retry/timeout state.
  - `Sentence.wsjAudioUrl`, `wsjAudioStartMs`, `wsjAudioEndMs`, and `wsjAudioStatus` own WSJ-derived sentence playback.
- Worker API:
  - `POST /audio/jobs` accepts `{ jobId, articleId, articleUrl, title, sentences, callbackUrl, callbackSecret, timeoutSeconds, coverageThreshold }`.
  - Worker posts callbacks to `POST /api/original-audio/ingest`.
  - `POST /audio/process` accepts the same payload and returns the same callback payload synchronously for the standalone TS worker path.
- Retry API:
  - `POST /api/articles/:id/original-audio/retry` accepts `{ timeoutSeconds }`.

### 3. Contracts

- `ArticleAudio.status` values: `pending`, `processing`, `ready`, `unavailable`, `failed`.
- `Sentence.wsjAudioStatus` values: `pending`, `ready`, `unavailable`, `failed`.
- Worker callback statuses: `running`, `succeeded`, `unavailable`, `failed`.
- Primary worker orchestration uses the standalone TS worker plus Python `/audio/process`; `/audio/jobs` remains available for compatibility callback flows.
- Required env keys for Docker flow:
  - `ORIGINAL_AUDIO_WORKER_URL`
  - `ORIGINAL_AUDIO_MIN_COVERAGE`
  - `ORIGINAL_AUDIO_MAX_ATTEMPTS`
  - `ORIGINAL_AUDIO_TIMEOUT_SECONDS`
  - `AUDIO_PUBLIC_DIR`
- Worker alignment env keys:
  - `ORIGINAL_AUDIO_ALIGNMENT_MIN_SCORE` defaults to `0.62` and controls the minimum text-match confidence for sentence clips.
  - `ORIGINAL_AUDIO_ALIGNMENT_SEARCH_WORDS` defaults to `240` and controls how far the aligner scans ahead after the previous matched sentence.
  - `ORIGINAL_AUDIO_ALIGNMENT_INITIAL_SEARCH_WORDS` defaults to `480` and gives the first article sentence extra room to skip WSJ title/intro audio.
- Worker and app containers must share the same `public/audio` volume. Sentence clips returned to the browser must use `/audio/wsj-clips/<articleId>/<sentenceId>.mp3`.
- Worker fallback alignment must match article sentence text to Whisper word timestamps by forward text-similarity search, not by raw token counts. Low-confidence sentences are omitted from the `clips` callback so Next.js can mark them unavailable and enforce coverage.

### 4. Validation & Error Matrix

- Invalid worker callback payload -> `400` from `/api/original-audio/ingest`.
- Missing or mismatched audio job -> `404` from `/api/original-audio/ingest`.
- Unauthorized worker or retry request -> `401`.
- Worker `unavailable` callback -> `ArticleAudio.status = unavailable`; do not consume retry attempts indefinitely.
- Worker `failed` callback or worker-start failure -> retry until `maxAttempts`, then `ArticleAudio.status = failed`.
- Coverage below `ORIGINAL_AUDIO_MIN_COVERAGE` -> treat as retryable failure until attempts are exhausted.
- Sentence alignment confidence below `ORIGINAL_AUDIO_ALIGNMENT_MIN_SCORE` -> omit that sentence clip; do not cut a guessed clip.
- Manual retry -> reset job attempts to `0`, apply custom timeout, reset sentence WSJ clip fields to pending.

### 5. Good/Base/Bad Cases

- Good: Article has source narration, coverage is at least threshold, `SentencePlayer` plays `wsjAudioUrl` and never calls `/api/tts`.
- Base: Article has no accessible narration, article page remains readable and shadow-reading entry is disabled.
- Bad: Worker rejects or times out; job retries, then failed state exposes manual retry with custom timeout.
- Bad: Audio starts with title/intro/author text; aligner skips those words before matching the first stored article sentence.
- Bad: Narration wording differs too much from stored article text; aligner marks those sentences unavailable instead of producing shifted clips.

### 6. Tests Required

- Unit tests for timeout normalization and coverage threshold behavior.
- Unit tests for API serialization of article-audio state.
- Worker tests for audio helper behavior, intro-skipping alignment, small narration text differences, and low-confidence rejection.
- Existing scraper ingest tests must still pass after audio enqueue is added.
- Lint/type-check must verify UI uses typed article-audio state and does not locally redefine callback contracts.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Do not treat old TTS audio as original WSJ audio.
play(sentence.audioUrl);
```

#### Correct

```typescript
if (sentence.wsjAudioStatus === "ready" && sentence.wsjAudioUrl) {
  play(sentence.wsjAudioUrl);
}
```

#### Wrong

```python
# Do not assign timings by sentence token count; WSJ audio can include title or intro text first.
end_cursor = cursor + len(tokenize_words(sentence.text))
segment_words = words[cursor:end_cursor]
```

#### Correct

```python
match = find_sentence_window(sentence_tokens, timed_tokens, cursor, search_limit)
if not match or match[2] < alignment_min_score(len(sentence_tokens)):
    continue
```

#### Wrong

```typescript
// Do not let original-audio queue failures break article ingest.
await enqueueArticleAudioJob(article.id);
```

#### Correct

```typescript
try {
  await enqueueArticleAudioJob(article.id);
} catch (error) {
  console.error("Failed to enqueue original-audio job:", error);
}
```
