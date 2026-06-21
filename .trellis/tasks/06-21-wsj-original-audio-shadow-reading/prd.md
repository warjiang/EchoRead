# Use WSJ original audio for shadow reading

## Goal

Replace the current text-to-speech centered shadow-reading audio flow with WSJ's original article narration when a logged-in WSJ article provides usable audio. Learners should practice against the real publisher recording, sliced into sentence-level clips that fit the existing shadow-reading workflow.

## User Value

- Learners hear the authentic WSJ narration instead of synthetic speech.
- Sentence-level playback remains convenient for shadow reading, repetition, and recording comparison.
- The app avoids generating unnecessary TTS audio for articles that already have a usable original recording.

## Confirmed Facts

- Current WSJ collection runs through `worker/wsj-worker/app/main.py`, using Playwright over CDP to collect article links and extract article snapshots.
- The current article ingest path creates `Article` and `Sentence` records in `src/lib/scraper/jobs.ts`.
- `Sentence.audioUrl` currently stores generated per-sentence audio.
- `src/app/api/tts/route.ts` generates sentence audio through Edge TTS on demand and in batch.
- `src/components/SentencePlayer.tsx` already plays sentence-level `audioUrl` values and generates missing audio by calling `/api/tts`.
- The shadow-reading page exposes a "Generate All Audio" action that currently triggers batch TTS.
- The database has no separate model for whole-article original audio, source audio status, alignment status, or sentence time ranges.

## Requirements

- The system must attempt to discover original WSJ article audio during article collection or a follow-up audio processing job.
- The system must use only audio that is available to the authenticated WSJ browser/session already configured for collection.
- The system must not bypass paywalls, DRM, or access controls.
- The system must cache downloaded source audio locally or in the configured app storage before creating sentence clips.
- The system must align the source narration to the stored article sentences and produce sentence-level playback ranges or clips.
- The MVP must materialize sentence-level audio as pre-cut clip files, with each playable sentence resolving to a clip URL.
- Sentence-level practice must continue to support manual sentence selection, previous/next controls, playback speed, and learner recording.
- The app must expose source-audio processing state clearly enough that users can distinguish ready, processing, unavailable, and failed audio.
- Article reading pages must remain available for all successfully scraped articles, including articles without usable WSJ original audio.
- Shadow-reading entry points must be disabled or clearly marked when WSJ original audio is unavailable, still processing, or failed.
- The MVP should mark an article shadow-readable only when sentence clip coverage reaches a high threshold. The default target threshold is 90% of stored sentences.
- When the article is shadow-readable but a small number of sentences lack usable clips, the practice UI should mark those sentences unavailable and skip them during autoplay.
- Source-audio processing must retry transient failures automatically. The default retry budget is 3 attempts.
- Each source-audio processing attempt must run with a configurable timeout. The MVP default target is 5 minutes per article unless implementation evidence suggests a safer value.
- When automatic attempts exceed the configured retry budget, the article audio state should become failed.
- Failed audio processing must support manual retry with a user-provided or request-provided custom timeout for the retry attempt.
- Manual retry must be available through an API endpoint and a lightweight developer/admin control on the article page.
- The MVP does not need a full audio-job administration dashboard.
- Confirmed absence of WSJ original audio is a terminal unavailable state and should not consume retry attempts indefinitely.
- The downloaded full-article WSJ source audio file must be retained after sentence clips are generated.
- Retained source audio is for local processing, debugging, and possible re-clipping. The app should not add a public user-facing download affordance for the full source audio.
- The MVP audio discovery, download, alignment, and sentence clipping work should run in the existing Python `wsj-worker`.
- The Next.js app should own persistence, API state, and frontend display for original-audio readiness.
- New articles should automatically enqueue or trigger source-audio processing in the background after successful scrape ingestion.
- Users should not need to open the article or shadow-reading page to start source-audio processing.
- The MVP should store source audio and generated sentence clips under new subdirectories of the existing `public/audio` volume.
- The intended local paths are `public/audio/wsj-source/<articleId>.<ext>` for full source files and `public/audio/wsj-clips/<articleId>/<sentenceId>.mp3` for sentence clips unless implementation evidence requires a small adjustment.
- The worker may introduce local transcription or forced-alignment dependencies when WSJ page/player data does not provide usable sentence timing.
- Audio timing should prefer publisher-provided transcript or timed metadata when available, then fall back to local worker-side transcription/alignment.
- Transcription and alignment dependencies must stay isolated to the Python `wsj-worker` for MVP.
- The exact transcription/alignment package should be selected during implementation through a worker-local adapter spike, without changing the product contract.
- Existing article scraping and training-package generation must continue to work for articles without usable original audio.
- The implementation must not generate new TTS audio for shadow-reading playback. Articles without usable WSJ original audio should not silently fall back to TTS.

## Constraints

- This is a complex cross-layer feature touching worker scraping, persistence, API contracts, and frontend playback.
- WSJ's article audio resource shape is not guaranteed and must be validated empirically against authenticated article pages.
- Original audio availability can vary per article.
- Sentence boundaries from article text may not exactly match narration phrasing, so alignment must tolerate small text differences.
- Any stored original audio should be treated as user-local learning material, not public redistribution content.

## Out of Scope

- Circumventing WSJ subscription, login, DRM, or anti-bot protections.
- Publishing or sharing WSJ audio outside the user's own deployment.
- Replacing the article text scraper with a general podcast/RSS ingestion system.
- Building pronunciation scoring or speech recognition feedback for the learner's recording.
- Supporting non-WSJ publishers in this task.

## Acceptance Criteria

- [ ] For a WSJ article that exposes original narration to the authenticated session, the app stores a source audio record and derives sentence-level playback assets or time ranges.
- [ ] For a sentence with aligned WSJ narration, the shadow-reading player plays the WSJ-derived audio instead of calling `/api/tts`.
- [ ] For an article without usable original narration, the UI shows a clear unavailable state and does not generate TTS.
- [ ] Articles without usable narration remain readable on the normal article page.
- [ ] Shadow-reading controls are not presented as usable until sentence clips are ready.
- [ ] An article is considered ready for shadow reading only when aligned clip coverage meets the configured high-coverage threshold.
- [ ] Autoplay and next/previous practice flows skip unavailable sentences without crashing or triggering TTS.
- [ ] Transient audio discovery, download, alignment, or clipping failures are retried up to the configured retry budget.
- [ ] Each processing attempt is bounded by a configured timeout and records timeout failures clearly.
- [ ] After the configured number of failed attempts, the article audio state becomes failed.
- [ ] A failed article audio job can be retried manually with a custom timeout value.
- [ ] Manual retry is available from an API endpoint.
- [ ] The article page includes a lightweight developer/admin control for retrying failed audio processing with a custom timeout.
- [ ] Articles confirmed to have no accessible original WSJ narration are marked unavailable without repeated retries.
- [ ] Successful processing leaves both the full source audio file and sentence clip files available in local app storage.
- [ ] The normal user interface exposes sentence clips for practice but does not expose a full-source-audio download action.
- [ ] The Python `wsj-worker` can process WSJ source audio without requiring a separate new worker service for MVP.
- [ ] Next.js APIs expose enough state for article pages and shadow-reading pages to show ready, processing, unavailable, or failed audio states.
- [ ] Newly ingested articles automatically begin original-audio processing in the background.
- [ ] Opening an article page or shadow-reading page does not synchronously block on audio discovery, download, alignment, or clipping.
- [ ] Source and clip files are stored under `public/audio` subdirectories that work with the existing Docker volume.
- [ ] Sentence clip URLs are browser-playable from the existing Next.js public assets path.
- [ ] The audio pipeline can use WSJ-provided timing metadata when available.
- [ ] The audio pipeline can fall back to worker-local transcription/alignment when publisher timing metadata is unavailable.
- [ ] Next.js does not import or directly execute transcription/alignment tooling.
- [ ] The chosen transcription/alignment implementation is isolated behind a worker adapter so it can be replaced after empirical validation.
- [ ] The system records processing failures in a way that can be surfaced or debugged without crashing article ingestion.
- [ ] Existing scrape job ingestion still succeeds when audio discovery or processing fails.
- [ ] Automated tests cover audio metadata ingestion, unavailable-audio behavior, and sentence playback source selection.
- [ ] Documentation explains the new audio requirements, storage behavior, and local-use boundary.

## Open Questions

- None blocking product planning. The exact transcription/alignment package is an implementation spike inside the worker adapter described in `design.md`.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
