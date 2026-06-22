import asyncio
import difflib
import os
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import BrowserContext, Error as PlaywrightError, Page, async_playwright

from app.config import logger
from app.models import (
    AudioClipCallback,
    AudioJobCallback,
    AudioJobRequest,
    AudioSentenceInput,
    AudioWordTimingCallback,
    AudioSource,
    SentenceTiming,
    WordTiming,
)
from app.scraper import clean_text


def audio_public_dir() -> Path:
    configured = os.environ.get("AUDIO_PUBLIC_DIR")
    if configured:
        path = Path(configured).expanduser()
        if path.is_absolute() and not path.exists() and str(path).startswith("/app/"):
            fallback = Path(__file__).resolve().parents[3] / "public" / "audio"
            logger.warning(
                "AUDIO_PUBLIC_DIR=%s is not available in local worker; using %s",
                configured,
                fallback,
            )
            return fallback
        return path

    return Path(__file__).resolve().parents[3] / "public" / "audio"


def audio_public_url(path: Path) -> str:
    root = audio_public_dir().resolve()
    resolved = path.resolve()
    relative = resolved.relative_to(root)
    return f"/audio/{relative.as_posix()}"


def extension_from_source(source: AudioSource) -> str:
    parsed_suffix = Path(urlparse(source.url).path).suffix.lower()
    if parsed_suffix in {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".webm"}:
        return parsed_suffix

    content_type = (source.contentType or "").lower()
    if "mpeg" in content_type or "mp3" in content_type:
        return ".mp3"
    if "mp4" in content_type or "m4a" in content_type:
        return ".m4a"
    if "aac" in content_type:
        return ".aac"
    if "wav" in content_type:
        return ".wav"
    if "ogg" in content_type:
        return ".ogg"
    if "webm" in content_type:
        return ".webm"
    return ".mp3"


def tokenize_words(value: str) -> list[str]:
    value = re.sub(r"\b(?:[A-Za-z]\.){2,}", lambda match: match.group(0).replace(".", ""), value)
    return re.findall(r"[A-Za-z0-9']+", value.lower())


def original_audio_float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    try:
        value = float(raw_value)
    except ValueError:
        logger.warning("%s=%s is not a number; using %.2f", name, raw_value, default)
        return default
    return min(max(value, minimum), maximum)


def original_audio_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    try:
        value = int(raw_value)
    except ValueError:
        logger.warning("%s=%s is not an integer; using %s", name, raw_value, default)
        return default
    return min(max(value, minimum), maximum)


def resolve_binary(env_name: str, binary_name: str) -> str | None:
    configured = os.environ.get(env_name)
    if configured:
        configured_path = Path(configured).expanduser()
        if configured_path.exists():
            return str(configured_path)
        found_configured = shutil.which(configured)
        if found_configured:
            return found_configured
        logger.warning("%s=%s does not resolve to an executable", env_name, configured)

    return shutil.which(binary_name)


def ffprobe_duration_ms(path: Path) -> int | None:
    ffprobe = resolve_binary("FFPROBE_BINARY", "ffprobe")
    if not ffprobe:
        return None

    try:
        result = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        duration_seconds = float(result.stdout.strip())
        return int(duration_seconds * 1000)
    except (subprocess.SubprocessError, ValueError) as error:
        logger.warning("Failed to probe audio duration for %s: %s", path, error)
        return None


async def discover_audio_source(page: Page, article_url: str) -> AudioSource | None:
    observed_sources: list[AudioSource] = []

    async def capture_response(response: object) -> None:
        try:
            url = response.url  # type: ignore[attr-defined]
            headers = await response.all_headers()  # type: ignore[attr-defined]
            content_type = headers.get("content-type")
            lowered_url = url.lower()
            if content_type and content_type.lower().startswith("audio/"):
                observed_sources.append(AudioSource(url=url, contentType=content_type))
            elif any(marker in lowered_url for marker in [".mp3", ".m4a", ".aac", ".wav", ".ogg", ".webm"]):
                observed_sources.append(AudioSource(url=url, contentType=content_type))
        except Exception as error:
            logger.debug("Ignoring audio response inspection failure: %s", error)

    def on_response(response: object) -> None:
        asyncio.create_task(capture_response(response))

    page.on("response", on_response)
    try:
        await page.goto(article_url, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(1_500)

        for selector in [
            'button:has-text("Listen")',
            'button:has-text("Listen to article")',
            '[aria-label*="Listen"]',
            '[data-testid*="listen"]',
        ]:
            try:
                locator = page.locator(selector).first
                if await locator.count() > 0:
                    await locator.click(timeout=2_000)
                    await page.wait_for_timeout(2_000)
                    break
            except Exception:
                continue

        discovered = await page.evaluate(
            """
            () => {
              const urls = new Set();
              const add = (value) => {
                if (!value || typeof value !== 'string') return;
                try {
                  const url = new URL(value, location.href).href;
                  if (/\\.(mp3|m4a|aac|wav|ogg|webm)(\\?|$)/i.test(url)) urls.add(url);
                } catch {}
              };

              for (const node of document.querySelectorAll('audio, source')) {
                add(node.getAttribute('src'));
              }
              for (const node of document.querySelectorAll('[data-audio-url], [data-src], [data-url]')) {
                add(node.getAttribute('data-audio-url'));
                add(node.getAttribute('data-src'));
                add(node.getAttribute('data-url'));
              }
              for (const script of document.querySelectorAll('script')) {
                const text = script.textContent || '';
                const matches = text.match(/https?:[^"'\\\\\\s]+\\.(?:mp3|m4a|aac|wav|ogg|webm)(?:\\?[^"'\\\\\\s]*)?/gi) || [];
                for (const match of matches) add(match.replace(/\\\\u0026/g, '&'));
              }
              return Array.from(urls);
            }
            """
        )

        if observed_sources:
            return observed_sources[0]
        if isinstance(discovered, list) and discovered:
            return AudioSource(url=str(discovered[0]))
        return None
    finally:
        page.remove_listener("response", on_response)


async def download_audio_source(context: BrowserContext, source: AudioSource, article_id: str) -> Path:
    source_dir = audio_public_dir() / "wsj-source"
    source_dir.mkdir(parents=True, exist_ok=True)
    extension = extension_from_source(source)
    output_path = source_dir / f"{article_id}{extension}"

    response = await context.request.get(source.url, timeout=60_000)
    if not response.ok:
        raise RuntimeError(f"Failed to download WSJ source audio: HTTP {response.status}")

    body = await response.body()
    if len(body) < 1024:
        raise RuntimeError("Downloaded WSJ source audio is unexpectedly small")

    output_path.write_bytes(body)
    return output_path


def transcribe_words(source_path: Path) -> list[WordTiming]:
    try:
        from faster_whisper import WhisperModel  # type: ignore[import-not-found]
    except ImportError as error:
        raise RuntimeError("faster-whisper is not installed in wsj-worker") from error

    model_name = os.environ.get("ORIGINAL_AUDIO_WHISPER_MODEL", "base.en")
    device = os.environ.get("ORIGINAL_AUDIO_WHISPER_DEVICE", "cpu")
    compute_type = os.environ.get("ORIGINAL_AUDIO_WHISPER_COMPUTE_TYPE", "int8")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, _info = model.transcribe(
        str(source_path),
        language="en",
        word_timestamps=True,
        vad_filter=True,
    )

    words: list[WordTiming] = []
    for segment in segments:
        for word in segment.words or []:
            text = clean_text(word.word)
            if text and word.start is not None and word.end is not None:
                words.append(WordTiming(word=text, start=float(word.start), end=float(word.end)))
    return words


def alignment_min_score(token_count: int) -> float:
    base_score = original_audio_float_env("ORIGINAL_AUDIO_ALIGNMENT_MIN_SCORE", 0.62, 0.1, 0.99)
    if token_count <= 3:
        return max(base_score, 0.86)
    if token_count <= 7:
        return max(base_score, 0.74)
    return base_score


def alignment_search_limit(is_initial_alignment: bool, token_count: int) -> int:
    configured = original_audio_int_env("ORIGINAL_AUDIO_ALIGNMENT_SEARCH_WORDS", 240, 20, 3000)
    limit = max(configured, token_count * 6)
    if is_initial_alignment:
        initial = original_audio_int_env("ORIGINAL_AUDIO_ALIGNMENT_INITIAL_SEARCH_WORDS", 480, 20, 5000)
        return max(limit, initial)
    return limit


def word_timing_tokens(words: list[WordTiming]) -> list[tuple[str, WordTiming]]:
    timed_tokens: list[tuple[str, WordTiming]] = []
    for word in words:
        for token in tokenize_words(word.word):
            timed_tokens.append((token, word))
    return timed_tokens


def token_sequence_score(expected: list[str], candidate: list[str]) -> float:
    if not expected or not candidate:
        return 0

    matcher = difflib.SequenceMatcher(a=expected, b=candidate, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    expected_coverage = matched / len(expected)
    candidate_coverage = matched / len(candidate)
    length_penalty = abs(len(expected) - len(candidate)) / max(len(expected), len(candidate))
    score = (matcher.ratio() * 0.55) + (expected_coverage * 0.35) + (candidate_coverage * 0.10)
    return max(0, min(1, score - (length_penalty * 0.08)))


def find_sentence_window(
    sentence_tokens: list[str],
    timed_tokens: list[tuple[str, WordTiming]],
    cursor: int,
    search_limit: int,
) -> tuple[int, int, float] | None:
    if not sentence_tokens or cursor >= len(timed_tokens):
        return None

    expected_length = len(sentence_tokens)
    start_limit = min(len(timed_tokens), cursor + search_limit)
    min_length = max(1, int(expected_length * 0.60))
    max_length = max(min_length, int(expected_length * 1.55) + 3)
    best: tuple[int, int, float] | None = None

    for start in range(cursor, start_limit):
        remaining = len(timed_tokens) - start
        for length in range(min_length, min(max_length, remaining) + 1):
            end = start + length
            candidate_tokens = [token for token, _word in timed_tokens[start:end]]
            score = token_sequence_score(sentence_tokens, candidate_tokens)
            if best is None or score > best[2]:
                best = (start, end, score)

    return best


def align_sentence_word_timings(
    sentence_tokens: list[str],
    timed_tokens: list[tuple[str, WordTiming]],
    start: int,
    end: int,
    confidence: float,
) -> list[AudioWordTimingCallback]:
    candidate_tokens = [token for token, _word in timed_tokens[start:end]]
    matcher = difflib.SequenceMatcher(a=sentence_tokens, b=candidate_tokens, autojunk=False)
    word_timings = [
        AudioWordTimingCallback(text=token, startMs=None, endMs=None, confidence=confidence)
        for token in sentence_tokens
    ]

    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            sentence_index = block.a + offset
            candidate_index = block.b + offset
            if sentence_index >= len(word_timings) or start + candidate_index >= end:
                continue
            source_word = timed_tokens[start + candidate_index][1]
            word_timings[sentence_index] = AudioWordTimingCallback(
                text=sentence_tokens[sentence_index],
                startMs=int(source_word.start * 1000),
                endMs=int(source_word.end * 1000),
                confidence=confidence,
            )

    return word_timings


def align_sentences_to_words(sentences: list[AudioSentenceInput], words: list[WordTiming]) -> list[SentenceTiming]:
    timings: list[SentenceTiming] = []
    timed_tokens = word_timing_tokens(words)
    cursor = 0

    for sentence in sorted(sentences, key=lambda item: item.index):
        sentence_tokens = tokenize_words(sentence.text)
        token_count = len(sentence_tokens)
        if token_count <= 0 or cursor >= len(timed_tokens):
            continue

        search_limit = alignment_search_limit(cursor == 0 and not timings, token_count)
        match = find_sentence_window(sentence_tokens, timed_tokens, cursor, search_limit)
        min_score = alignment_min_score(token_count)
        if not match or match[2] < min_score:
            best_score = match[2] if match else 0
            logger.warning(
                "Skipping low-confidence audio alignment sentence=%s index=%s score=%.2f threshold=%.2f",
                sentence.id,
                sentence.index,
                best_score,
                min_score,
            )
            continue

        start, end, score = match
        segment_words = [word for _token, word in timed_tokens[start:end]]
        if not segment_words:
            continue

        timing = SentenceTiming(
            sentenceId=sentence.id,
            start=max(0, segment_words[0].start - 0.12),
            end=segment_words[-1].end + 0.2,
            confidence=score,
            words=align_sentence_word_timings(sentence_tokens, timed_tokens, start, end, score),
        )
        timings.append(timing)
        cursor = end
        logger.info(
            "Aligned sentence %s index=%s confidence=%.2f start=%.2fs end=%.2fs",
            sentence.id,
            sentence.index,
            timing.confidence,
            timing.start,
            timing.end,
        )

    return timings


async def align_audio(source_path: Path, sentences: list[AudioSentenceInput]) -> list[SentenceTiming]:
    words = await asyncio.to_thread(transcribe_words, source_path)
    if not words:
        raise RuntimeError("Transcription produced no word timings")
    return align_sentences_to_words(sentences, words)


async def clip_sentence_audio(source_path: Path, article_id: str, timings: list[SentenceTiming]) -> list[AudioClipCallback]:
    ffmpeg = resolve_binary("FFMPEG_BINARY", "ffmpeg")
    if not ffmpeg:
        raise RuntimeError(
            "ffmpeg is required to cut WSJ sentence clips. Install it with `brew install ffmpeg` "
            "or set FFMPEG_BINARY to the ffmpeg executable path."
        )

    clip_dir = audio_public_dir() / "wsj-clips" / article_id
    clip_dir.mkdir(parents=True, exist_ok=True)
    clips: list[AudioClipCallback] = []

    for timing in timings:
        output_path = clip_dir / f"{timing.sentenceId}.mp3"
        duration = max(0.1, timing.end - timing.start)
        command = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{timing.start:.3f}",
            "-i",
            str(source_path),
            "-t",
            f"{duration:.3f}",
            "-vn",
            "-acodec",
            "libmp3lame",
            "-ar",
            "44100",
            "-ac",
            "2",
            str(output_path),
        ]
        try:
            await asyncio.to_thread(subprocess.run, command, check=True, capture_output=True)
            clips.append(
                AudioClipCallback(
                    sentenceId=timing.sentenceId,
                    audioUrl=audio_public_url(output_path),
                    startMs=int(timing.start * 1000),
                    endMs=int(timing.end * 1000),
                    status="ready",
                    words=timing.words,
                )
            )
        except subprocess.SubprocessError as error:
            logger.warning("Failed to clip sentence %s: %s", timing.sentenceId, error)
            clips.append(AudioClipCallback(sentenceId=timing.sentenceId, status="failed"))

    return clips


async def process_audio_job(request: AudioJobRequest) -> AudioJobCallback:
    cdp_url = os.environ.get("BROWSER_CDP_URL", "http://chrome:9222")

    async with async_playwright() as playwright:
        try:
            browser = await playwright.chromium.connect_over_cdp(cdp_url)
        except PlaywrightError as error:
            raise RuntimeError(f"Failed to connect to BROWSER_CDP_URL={cdp_url}") from error

        existing_contexts = browser.contexts
        context = existing_contexts[0] if existing_contexts else await browser.new_context()
        owns_context = not existing_contexts
        page = await context.new_page()
        page.set_default_timeout(15_000)

        try:
            source = await discover_audio_source(page, str(request.articleUrl))
            if not source:
                return AudioJobCallback(
                    jobId=request.jobId,
                    articleId=request.articleId,
                    status="unavailable",
                    errorMessage="No accessible WSJ article audio found",
                )

            source_path = await download_audio_source(context, source, request.articleId)
            timings = await align_audio(source_path, request.sentences)
            clips = await clip_sentence_audio(source_path, request.articleId, timings)
            ready_count = len([clip for clip in clips if clip.status == "ready"])
            coverage = ready_count / len(request.sentences)

            return AudioJobCallback(
                jobId=request.jobId,
                articleId=request.articleId,
                status="succeeded",
                sourceUrl=source.url,
                sourceAudioUrl=audio_public_url(source_path),
                sourcePath=str(source_path),
                durationMs=ffprobe_duration_ms(source_path),
                coverageRatio=coverage,
                clips=clips,
            )
        finally:
            await page.close()
            if owns_context:
                await context.close()


async def build_audio_job_callback(request: AudioJobRequest) -> AudioJobCallback:
    try:
        return await asyncio.wait_for(process_audio_job(request), timeout=request.timeoutSeconds)
    except asyncio.TimeoutError:
        return AudioJobCallback(
            jobId=request.jobId,
            articleId=request.articleId,
            status="failed",
            errorMessage=f"Timed out after {request.timeoutSeconds} seconds",
        )
    except Exception as error:
        logger.exception("Audio job %s failed", request.jobId)
        return AudioJobCallback(
            jobId=request.jobId,
            articleId=request.articleId,
            status="failed",
            errorMessage=str(error)[:1500],
        )
