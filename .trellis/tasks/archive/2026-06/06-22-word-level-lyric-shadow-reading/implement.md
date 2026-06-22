# Word-Level Lyric Shadow Reading Implementation Plan

## Preparation

- Load `trellis-before-dev`.
- Read original-audio and worker-pipeline contracts plus shared cross-layer/code-reuse guides.
- Inspect current dirty schema/auth changes and avoid overwriting unrelated work.

## Implementation Steps

1. Add `Sentence.wsjAudioWordsJson` to Drizzle schema and a migration.
2. Add shared lyric timing types/helpers for parsing, serialization, timing lookup, and playable sentence selection.
3. Extend Python audio models/alignment so ready clip callbacks include canonical word timings.
4. Extend TS original-audio ingest/retry/reset paths to validate, store, clear, and serialize word timing JSON.
5. Update article API to return typed `wsjAudioWords` while hiding raw JSON.
6. Add a lyric-aware source-audio player and use it on the shadow page when source audio and timed words are available.
7. Add tests for Python timing output, TS ingest/serialization, lyric helper behavior, and no-TTS fallback boundaries.

## Validation

- `pnpm lint`
- `pnpm test:original-audio`
- `pnpm test:shadow`
- `cd worker/wsj-worker && uv run python -m unittest discover -s tests`

## Rollback Points

- If full-source lyric UI has issues, keep the schema/API/worker timing data and force the shadow page to use the sentence-clip fallback.
- If worker timing output is unstable, store no `words` arrays while preserving existing clip callback behavior.
