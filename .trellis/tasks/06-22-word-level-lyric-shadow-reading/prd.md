# Add word-level lyric shadow reading

## Goal

Add a word-level lyric timeline to the WSJ original-audio shadow-reading experience so learners can follow the full article narration with synchronized sentence scrolling and per-word highlighting.

## User Value

- Learners practice against authentic WSJ narration with karaoke-style visual timing.
- Full-article playback makes shadowing feel continuous instead of a list of isolated clips.
- Sentence clips remain available as a compatibility fallback for existing ready articles.

## Requirements

- Preserve Whisper word timings already produced by the Python audio worker and return them with ready clip callbacks.
- Store each sentence's canonical article-token timing data in a nullable `Sentence.wsjAudioWordsJson` field.
- Word timings must use absolute source-audio milliseconds, not per-clip offsets.
- API responses must expose parsed `wsjAudioWords` arrays and must not expose the raw JSON field.
- Original-audio retry, admin reset, and article content edit paths must clear stored word timing JSON along with existing WSJ clip fields.
- The shadow-reading page must prefer whole-article `originalAudio.sourceAudioUrl` when available.
- The shadow player must derive active sentence and active word from audio `currentTime`, scroll/focus the active sentence, and highlight timed words.
- Untimed words should render normally and never be guessed into an active highlight.
- The player must keep previous/next sentence controls, playback speed, learner recording integration, and a single-sentence loop mode.
- If a ready article has no word timings, the UI must fall back to the existing sentence-clip player behavior.
- The shadow-reading flow must not call `/api/tts`.

## Out of Scope

- Pronunciation scoring or speech-recognition feedback.
- New LLM prompts or training-package schema changes.
- Automatic backfill for historical ready articles; users can re-run original-audio processing to populate word timings.

## Acceptance Criteria

- [ ] Python alignment returns per-word timings for matched sentence tokens and leaves unmatched canonical tokens untimed.
- [ ] Low-confidence sentence alignments still omit clip and word timing data.
- [ ] Successful original-audio ingest persists `wsjAudioWordsJson` for ready sentences.
- [ ] Retry/reset/edit paths clear `wsjAudioWordsJson`.
- [ ] `GET /api/articles/:id` returns `wsjAudioWords` arrays and hides raw `wsjAudioWordsJson`.
- [ ] Shadow reading uses full-source playback with synchronized word highlighting when source audio and timings are available.
- [ ] Shadow reading falls back to sentence clips when word timings are missing.
- [ ] Single-sentence loop and previous/next controls work without triggering TTS.
- [ ] Automated tests cover worker timing output, ingest/serialization, lyric timing helpers, and no-TTS playback source selection.
