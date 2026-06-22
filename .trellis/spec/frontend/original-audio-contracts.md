# Original Audio Contracts

## Scenario: WSJ Original Audio Shadow Reading

### 1. Scope / Trigger

- Trigger: Original-audio processing crosses database schema, Next.js APIs, Python worker callbacks, Docker volumes, environment variables, and frontend playback.
- Applies when changing WSJ original audio discovery, article audio state, sentence clip fields, retry behavior, or shadow-reading playback source selection.

### 2. Signatures

- DB:
  - `ArticleAudio.articleId` is unique and owns article-level original-audio state.
  - `ArticleAudioJob.articleId` is unique and owns retry/timeout state.
  - `Sentence.wsjAudioUrl`, `wsjAudioStartMs`, `wsjAudioEndMs`, `wsjAudioStatus`, and `wsjAudioWordsJson` own WSJ-derived sentence playback.
  - `Sentence.wsjAudioWordsJson` stores nullable JSON for canonical article-token timings: `{ text, startMs, endMs, confidence? }[]`.
- Worker task:
  - TS worker creates `WsjWorkerTask.kind = "audio"` with payload `{ jobId, articleId, articleUrl, title, sentences, timeoutSeconds, coverageThreshold }`.
  - Python worker polls SQLite, processes the task, and writes the former callback payload into `WsjWorkerTask.resultJson`.
  - TS worker consumes completed task results through `ingestArticleAudioUpdate`.
- Retry API:
  - `POST /api/articles/:id/original-audio/retry` accepts `{ timeoutSeconds }`.

### 3. Contracts

- `ArticleAudio.status` values: `pending`, `processing`, `ready`, `unavailable`, `failed`.
- `Sentence.wsjAudioStatus` values: `pending`, `ready`, `unavailable`, `failed`.
- Worker result statuses: `running`, `succeeded`, `unavailable`, `failed`.
- Worker ready clips may include `words`; word `startMs` / `endMs` are absolute offsets in the full WSJ source audio, not sentence-clip-relative offsets.
- `GET /api/articles/:id` must serialize sentence word timings as `wsjAudioWords` and must not expose raw `wsjAudioWordsJson`.
- Primary worker orchestration uses the standalone TS worker plus Python DB-polled `WsjWorkerTask`; no original-audio worker/callback HTTP routes are used.
- Required env keys for Docker flow:
  - `DATABASE_URL`
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

- Unauthorized retry request -> `401`.
- Missing, stale, or mismatched `WsjWorkerTask` result -> consume stale task when attempts no longer match; otherwise retry/fail the domain job.
- Worker `unavailable` result -> `ArticleAudio.status = unavailable`; do not consume retry attempts indefinitely.
- Worker `failed` result or Python task failure -> retry until `maxAttempts`, then `ArticleAudio.status = failed`.
- Coverage below `ORIGINAL_AUDIO_MIN_COVERAGE` -> treat as retryable failure until attempts are exhausted.
- Sentence alignment confidence below `ORIGINAL_AUDIO_ALIGNMENT_MIN_SCORE` -> omit that sentence clip; do not cut a guessed clip.
- Low-confidence sentence word timing -> omit the whole sentence clip/words payload; do not keep guessed word timings for unavailable sentences.
- Manual retry/reset -> reset job attempts to `0`, apply custom timeout, reset sentence WSJ clip fields and `wsjAudioWordsJson` to pending/null.

### 5. Good/Base/Bad Cases

- Good: Article has source narration, coverage is at least threshold, `SentencePlayer` plays `wsjAudioUrl` and never calls `/api/tts`.
- Good: Article has source narration and word timings, the shadow page plays `ArticleAudio.sourceAudioUrl` and derives active sentence/word from absolute `wsjAudioWords` offsets.
- Base: Article has no accessible narration, article page remains readable and shadow-reading entry is disabled.
- Base: Existing ready article has sentence clips but no word timings, shadow reading falls back to sentence-clip playback.
- Bad: Python worker task fails or times out; job retries, then failed state exposes manual retry with custom timeout.
- Bad: Audio starts with title/intro/author text; aligner skips those words before matching the first stored article sentence.
- Bad: Narration wording differs too much from stored article text; aligner marks those sentences unavailable instead of producing shifted clips.

### 6. Tests Required

- Unit tests for timeout normalization and coverage threshold behavior.
- Unit tests for API serialization of article-audio state.
- Worker tests for DB task claim/complete/fail behavior, audio helper behavior, intro-skipping alignment, small narration text differences, and low-confidence rejection.
- Unit tests for lyric timing parsing, active sentence/word lookup, and API serialization that hides raw `wsjAudioWordsJson`.
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

```typescript
// Do not leak raw timing JSON to client components.
return NextResponse.json({ sentences });
```

#### Correct

```typescript
return NextResponse.json({
  sentences: sentences.map(serializeSentenceForArticleApi),
});
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
