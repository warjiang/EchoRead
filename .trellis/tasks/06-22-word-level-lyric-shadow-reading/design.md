# Word-Level Lyric Shadow Reading Design

## Architecture

- Keep the existing original-audio pipeline as the source of truth for article readiness and sentence clip coverage.
- Extend the Python worker callback payload with optional per-sentence `words` arrays produced during sentence alignment.
- Persist the callback word data on `Sentence` as `wsjAudioWordsJson`; expose parsed data through the article API.
- Replace the primary shadow page player with a lyric-aware full-source player when an article has `originalAudio.sourceAudioUrl` and at least one timed word.
- Keep the current sentence-clip player as the fallback for ready articles without lyric timing data.

## Contracts

- Word timing shape:

```ts
type WsjAudioWordTiming = {
  text: string;
  startMs: number | null;
  endMs: number | null;
  confidence?: number;
};
```

- Python `AudioClipCallback` adds `words?: WsjAudioWordTiming[]`.
- `startMs` and `endMs` values are whole-source absolute milliseconds.
- Invalid timing values are dropped or normalized by a shared TS parser before storage/API serialization.
- Raw JSON remains internal; UI consumes only typed `wsjAudioWords`.

## Data Flow

1. Python transcribes full source audio into word timings.
2. `align_sentences_to_words` matches canonical article sentence tokens against transcribed tokens and stores matched source word windows.
3. `clip_sentence_audio` returns existing clip metadata plus canonical word timings for each ready clip.
4. TS audio ingest validates and stores clip URLs, sentence ranges, and word JSON in one transaction.
5. Article API returns sentences with `wsjAudioWords`.
6. Shadow page chooses full-source lyric playback when any sentence has timed words; otherwise it uses sentence clips.

## UI Behavior

- The lyric player owns one `<audio>` element for `sourceAudioUrl`.
- On sentence click or previous/next, seek to `sentence.wsjAudioStartMs`.
- On `timeupdate`, compute active sentence from sentence start/end ranges and active word from word start/end ranges.
- In loop mode, when `currentTime` reaches the current sentence end, seek back to that sentence start and continue playing.
- Untimed words are rendered inline but never receive active-word styling.

## Compatibility

- Existing `Sentence.wsjAudioUrl`, `wsjAudioStartMs`, `wsjAudioEndMs`, and `wsjAudioStatus` semantics stay unchanged.
- Existing ready articles continue to work through sentence-clip fallback.
- No new worker service or external lyric provider is introduced.
