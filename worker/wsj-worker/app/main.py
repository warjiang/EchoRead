import asyncio
import difflib
import json
import logging
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.request import Request as UrlRequest, urlopen

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from playwright.async_api import BrowserContext, Error as PlaywrightError, Page, TimeoutError as PlaywrightTimeoutError, async_playwright
from pydantic import BaseModel, Field, HttpUrl


logger = logging.getLogger(__name__)


def load_project_env() -> None:
    env_path = Path(__file__).resolve().parents[3] / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_project_env()


def configure_logging() -> None:
    level_name = os.environ.get("WSJ_WORKER_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logger.setLevel(level)

    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
        )
        logger.addHandler(handler)
    logger.propagate = False


configure_logging()

WSJ_HOME_URL = "https://www.wsj.com/"
WSJ_SOURCE_URLS = [
    WSJ_HOME_URL,
    "https://www.wsj.com/business",
    "https://www.wsj.com/finance",
    "https://www.wsj.com/tech",
    "https://www.wsj.com/news/world",
    "https://www.wsj.com/news/us",
    "https://www.wsj.com/world",
    "https://www.wsj.com/us-news",
    "https://www.wsj.com/economy",
    "https://www.wsj.com/politics",
]

WSJ_ARTICLE_SECTION_ROOTS = {
    "articles",
    "business",
    "economy",
    "finance",
    "lifestyle",
    "personal-finance",
    "politics",
    "real-estate",
    "tech",
    "us-news",
    "world",
}

ARTICLE_SNAPSHOT_SCRIPT = """
() => {
  const text = (node) => node?.textContent?.replace(/\\s+/g, " ").trim() || null;
  const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) || null;
  const meta = (name) =>
    attr(`meta[property="${name}"]`, "content") ||
    attr(`meta[name="${name}"]`, "content");

  const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map((node) => {
      try {
        return JSON.parse(node.textContent || "{}");
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const paragraphSelectors = [
    'article [data-type="paragraph"]',
    'article p',
    '[data-testid="article-body"] p',
    '[class*="articleBody"] p',
    '[class*="ArticleBody"] p',
    'section[name="articleBody"] p'
  ];
  const paragraphs = [];
  for (const selector of paragraphSelectors) {
    for (const node of Array.from(document.querySelectorAll(selector))) {
      const value = text(node);
      if (value) paragraphs.push(value);
    }
    if (paragraphs.length >= 3) break;
  }

  return {
    title: text(document.querySelector("h1")),
    canonicalUrl: attr('link[rel="canonical"]', "href"),
    ogTitle: meta("og:title"),
    section: meta("article:section"),
    publishedAt: meta("article:published_time") || attr("time[datetime]", "datetime"),
    category: text(document.querySelector('[data-testid*="breadcrumb"] a, nav a[href*="/news/"]')),
    paragraphs,
    jsonLd,
  };
}
"""


class ScrapeRequest(BaseModel):
    maxArticles: int = Field(default=5, ge=1, le=10)


class ScrapedArticle(BaseModel):
    title: str = Field(min_length=10)
    url: HttpUrl
    content: str = Field(min_length=100)
    category: str | None = None
    publishedAt: datetime | None = None


class ScrapeResult(BaseModel):
    articles: list[ScrapedArticle] = Field(default_factory=list)


class ScrapeJobRequest(BaseModel):
    jobId: str = Field(min_length=1)
    maxArticles: int = Field(default=5, ge=1, le=10)
    callbackUrl: HttpUrl
    callbackSecret: str | None = None


class ScrapeJobAccepted(BaseModel):
    jobId: str
    status: Literal["accepted"]


class ScrapeJobCallback(BaseModel):
    jobId: str
    status: Literal["running", "succeeded", "failed"]
    articles: list[ScrapedArticle] = Field(default_factory=list)
    errorMessage: str | None = None


class AudioSentenceInput(BaseModel):
    id: str = Field(min_length=1)
    index: int = Field(ge=0)
    text: str = Field(min_length=1)


class AudioJobRequest(BaseModel):
    jobId: str = Field(min_length=1)
    articleId: str = Field(min_length=1)
    articleUrl: HttpUrl
    title: str = Field(min_length=1)
    sentences: list[AudioSentenceInput] = Field(min_length=1)
    callbackUrl: HttpUrl
    callbackSecret: str | None = None
    timeoutSeconds: int = Field(default=300, ge=30, le=3600)
    coverageThreshold: float = Field(default=0.9, ge=0, le=1)


class AudioJobAccepted(BaseModel):
    jobId: str
    status: Literal["accepted"]


class AudioClipCallback(BaseModel):
    sentenceId: str
    audioUrl: str | None = None
    startMs: int | None = None
    endMs: int | None = None
    status: Literal["ready", "unavailable", "failed"] = "unavailable"


class AudioJobCallback(BaseModel):
    jobId: str
    articleId: str
    status: Literal["running", "succeeded", "unavailable", "failed"]
    sourceUrl: str | None = None
    sourceAudioUrl: str | None = None
    sourcePath: str | None = None
    durationMs: int | None = None
    coverageRatio: float | None = None
    clips: list[AudioClipCallback] = Field(default_factory=list)
    errorMessage: str | None = None


class AudioSource(BaseModel):
    url: str
    contentType: str | None = None


class WordTiming(BaseModel):
    word: str
    start: float
    end: float


class SentenceTiming(BaseModel):
    sentenceId: str
    start: float
    end: float
    confidence: float = 0


app = FastAPI(title="EchoRead WSJ Worker")


def require_secret(authorization: Annotated[str | None, Header()] = None) -> None:
    secret = os.environ.get("SCRAPER_WORKER_SECRET")
    if not secret:
        return

    token = (authorization or "").removeprefix("Bearer ").strip()
    if token != secret:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def normalize_article_url(raw_url: str | None, base_url: str = WSJ_HOME_URL) -> str | None:
    if not raw_url:
        return None

    parsed = urlparse(urljoin(base_url, raw_url))
    if not parsed.netloc.endswith("wsj.com"):
        return None

    path = parsed.path.rstrip("/")
    parts = [part for part in path.split("/") if part]
    if not parts:
        return None
    if parts[0] not in WSJ_ARTICLE_SECTION_ROOTS:
        return None
    if parts[0] == "articles":
        is_article_path = True
    else:
        slug = parts[-1]
        is_article_path = bool(re.search(r"-[0-9a-f]{8,}$", slug))
    if not is_article_path:
        return None

    lowered = path.lower()
    if any(marker in lowered for marker in ["/video/", "/livecoverage/", "/market-data/", "/podcasts/"]):
        return None

    return urlunparse(("https", parsed.netloc.lower(), path, "", "", ""))


def clean_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split()).strip()


def unique_paragraphs(paragraphs: list[Any]) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    blocked_fragments = [
        "subscribe",
        "sign in",
        "advertisement",
        "continue reading",
        "listen to article",
    ]

    for paragraph in paragraphs:
        text = clean_text(paragraph)
        if len(text) < 25:
            continue
        lowered = text.lower()
        if any(fragment in lowered for fragment in blocked_fragments):
            continue
        if text in seen:
            continue
        seen.add(text)
        cleaned.append(text)

    return cleaned


def iter_json_ld_nodes(value: Any) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []

    if isinstance(value, dict):
        nodes.append(value)
        graph = value.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                nodes.extend(iter_json_ld_nodes(item))
    elif isinstance(value, list):
        for item in value:
            nodes.extend(iter_json_ld_nodes(item))

    return nodes


def find_json_ld_value(json_ld: list[Any], key: str) -> str | None:
    for document in json_ld:
        for node in iter_json_ld_nodes(document):
            value = node.get(key)
            if isinstance(value, str) and clean_text(value):
                return clean_text(value)
    return None


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def category_from_url(url: str) -> str | None:
    parts = [part for part in urlparse(url).path.split("/") if part]
    if len(parts) >= 2 and parts[0] == "news":
        return parts[1].replace("-", " ").title()
    if parts and parts[0] in WSJ_ARTICLE_SECTION_ROOTS and parts[0] != "articles":
        return parts[0].replace("-", " ").title()
    return None


def build_article_from_snapshot(snapshot: dict[str, Any], current_url: str) -> ScrapedArticle | None:
    json_ld = snapshot.get("jsonLd") if isinstance(snapshot.get("jsonLd"), list) else []
    canonical_url = normalize_article_url(snapshot.get("canonicalUrl"), current_url)
    url = canonical_url or normalize_article_url(current_url)
    if not url:
        return None

    title = (
        clean_text(snapshot.get("title"))
        or clean_text(snapshot.get("ogTitle"))
        or clean_text(find_json_ld_value(json_ld, "headline"))
    )

    paragraphs = unique_paragraphs(snapshot.get("paragraphs") if isinstance(snapshot.get("paragraphs"), list) else [])
    content = "\n\n".join(paragraphs)
    if len(content) < 100:
        content = clean_text(find_json_ld_value(json_ld, "articleBody"))

    if len(title) < 10 or len(content) < 100:
        return None

    published_at = (
        parse_datetime(clean_text(find_json_ld_value(json_ld, "datePublished")))
        or parse_datetime(clean_text(snapshot.get("publishedAt")))
        or datetime.now(timezone.utc)
    )
    category = (
        clean_text(snapshot.get("category"))
        or clean_text(snapshot.get("section"))
        or category_from_url(url)
    )

    return ScrapedArticle(
        title=title,
        url=url,
        content=content,
        category=category or None,
        publishedAt=published_at,
    )


async def collect_candidate_links(page: Page, max_candidates: int) -> list[str]:
    raw_links = await page.evaluate(
        """
        () => Array.from(document.querySelectorAll('a[href]')).map((link) => ({
          href: link.href,
          text: link.textContent || "",
          aria: link.getAttribute("aria-label") || "",
          title: link.getAttribute("title") || "",
          data: link.getAttribute("data-testid") || ""
        }))
        """
    )

    candidates: list[str] = []
    seen: set[str] = set()
    for link in raw_links:
        if not isinstance(link, dict):
            continue
        text = (
            clean_text(link.get("text"))
            or clean_text(link.get("aria"))
            or clean_text(link.get("title"))
            or clean_text(link.get("data"))
        )
        url = normalize_article_url(link.get("href"))
        if not url or url in seen:
            continue
        if len(text) < 10:
            continue
        seen.add(url)
        candidates.append(url)
        if len(candidates) >= max_candidates:
            break

    return candidates


async def extract_article_payload(page: Page) -> ScrapedArticle | None:
    snapshot = await page.evaluate(ARTICLE_SNAPSHOT_SCRIPT)
    if not isinstance(snapshot, dict):
        return None
    return build_article_from_snapshot(snapshot, page.url)


async def scrape_article_page(context: BrowserContext, url: str) -> ScrapedArticle | None:
    page = await context.new_page()
    page.set_default_timeout(15_000)
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(1_000)
        return await extract_article_payload(page)
    finally:
        await page.close()


async def collect_articles(max_articles: int) -> ScrapeResult:
    cdp_url = os.environ.get("BROWSER_CDP_URL", "http://chrome:9222")
    max_candidates = max(20, max_articles * 8)
    candidate_urls: list[str] = []
    seen_candidates: set[str] = set()
    logger.info("Starting WSJ collection max_articles=%s cdp_url=%s", max_articles, cdp_url)

    async with async_playwright() as playwright:
        try:
            browser = await playwright.chromium.connect_over_cdp(cdp_url)
        except PlaywrightError as error:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Failed to connect to BROWSER_CDP_URL={cdp_url}. "
                    "Use http://127.0.0.1:9222 or your external CDP endpoint for a local worker; "
                    "http://chrome:9222 only works inside Docker Compose."
                ),
            ) from error

        existing_contexts = browser.contexts
        context = existing_contexts[0] if existing_contexts else await browser.new_context()
        owns_context = not existing_contexts
        source_page = await context.new_page()
        source_page.set_default_timeout(15_000)

        try:
            for source_url in WSJ_SOURCE_URLS:
                try:
                    logger.info("Collecting WSJ candidate links from %s", source_url)
                    await source_page.goto(source_url, wait_until="domcontentloaded", timeout=30_000)
                    await source_page.wait_for_timeout(1_000)
                    links = await collect_candidate_links(source_page, max_candidates)
                    logger.info("Collected %s candidate links from %s", len(links), source_url)
                except PlaywrightTimeoutError as error:
                    logger.warning("Timed out collecting WSJ links from %s: %s", source_url, error)
                    continue
                except Exception as error:
                    logger.warning("Failed to collect WSJ links from %s: %s", source_url, error)
                    continue

                for url in links:
                    if url not in seen_candidates:
                        seen_candidates.add(url)
                        candidate_urls.append(url)
                    if len(candidate_urls) >= max_candidates:
                        break
                if len(candidate_urls) >= max_candidates:
                    break

            logger.info("Collected %s unique WSJ candidate links", len(candidate_urls))
            articles: list[ScrapedArticle] = []
            seen_articles: set[str] = set()
            for url in candidate_urls:
                try:
                    logger.info("Scraping WSJ article candidate %s", url)
                    article = await scrape_article_page(context, url)
                except PlaywrightTimeoutError as error:
                    logger.warning("Timed out scraping WSJ article %s: %s", url, error)
                    continue
                except Exception as error:
                    logger.warning("Failed to scrape WSJ article %s: %s", url, error)
                    continue

                if not article:
                    logger.info("Skipped WSJ article candidate with no valid payload: %s", url)
                    continue
                article_url = str(article.url)
                if article_url in seen_articles:
                    logger.info("Skipped duplicate WSJ article in worker result: %s", article_url)
                    continue
                seen_articles.add(article_url)
                articles.append(article)
                logger.info("Accepted WSJ article: %s (%s)", article.title, article_url)
                if len(articles) >= max_articles:
                    break
        finally:
            await source_page.close()
            if owns_context:
                await context.close()

    if not articles:
        raise HTTPException(
            status_code=502,
            detail=f"No valid WSJ articles collected from {len(candidate_urls)} candidate links",
        )

    logger.info("Finished WSJ collection with %s article(s)", len(articles))
    return ScrapeResult(articles=articles)


async def post_job_callback(request: ScrapeJobRequest, callback: ScrapeJobCallback) -> None:
    payload = json.dumps(callback.model_dump(mode="json", exclude_none=True)).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
    }
    if request.callbackSecret:
        headers["Authorization"] = f"Bearer {request.callbackSecret}"

    url_request = UrlRequest(
        str(request.callbackUrl),
        data=payload,
        headers=headers,
        method="POST",
    )

    def send() -> None:
        with urlopen(url_request, timeout=30) as response:
            if response.status >= 400:
                raise HTTPError(
                    str(request.callbackUrl),
                    response.status,
                    response.reason,
                    response.headers,
                    response,
                )

    try:
        await asyncio.to_thread(send)
        logger.info("Posted scrape callback job=%s status=%s articles=%s", request.jobId, callback.status, len(callback.articles))
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        logger.exception("Failed to post scrape job callback for %s: %s", request.jobId, error)


async def post_audio_job_callback(request: AudioJobRequest, callback: AudioJobCallback) -> None:
    payload = json.dumps(callback.model_dump(mode="json", exclude_none=True)).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
    }
    if request.callbackSecret:
        headers["Authorization"] = f"Bearer {request.callbackSecret}"

    url_request = UrlRequest(
        str(request.callbackUrl),
        data=payload,
        headers=headers,
        method="POST",
    )

    def send() -> None:
        with urlopen(url_request, timeout=30) as response:
            if response.status >= 400:
                raise HTTPError(
                    str(request.callbackUrl),
                    response.status,
                    response.reason,
                    response.headers,
                    response,
                )

    try:
        await asyncio.to_thread(send)
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        logger.exception("Failed to post audio job callback for %s: %s", request.jobId, error)


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

    async def capture_response(response: Any) -> None:
        try:
            url = response.url
            headers = await response.all_headers()
            content_type = headers.get("content-type")
            lowered_url = url.lower()
            if content_type and content_type.lower().startswith("audio/"):
                observed_sources.append(AudioSource(url=url, contentType=content_type))
            elif any(marker in lowered_url for marker in [".mp3", ".m4a", ".aac", ".wav", ".ogg", ".webm"]):
                observed_sources.append(AudioSource(url=url, contentType=content_type))
        except Exception as error:
            logger.debug("Ignoring audio response inspection failure: %s", error)

    def on_response(response: Any) -> None:
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


async def run_audio_job(request: AudioJobRequest) -> None:
    await post_audio_job_callback(
        request,
        AudioJobCallback(jobId=request.jobId, articleId=request.articleId, status="running"),
    )

    try:
        callback = await asyncio.wait_for(process_audio_job(request), timeout=request.timeoutSeconds)
    except asyncio.TimeoutError:
        callback = AudioJobCallback(
            jobId=request.jobId,
            articleId=request.articleId,
            status="failed",
            errorMessage=f"Timed out after {request.timeoutSeconds} seconds",
        )
    except Exception as error:
        logger.exception("Audio job %s failed", request.jobId)
        callback = AudioJobCallback(
            jobId=request.jobId,
            articleId=request.articleId,
            status="failed",
            errorMessage=str(error)[:1500],
        )

    await post_audio_job_callback(request, callback)


async def run_scrape_job(request: ScrapeJobRequest) -> None:
    logger.info("Running WSJ scrape job %s max_articles=%s", request.jobId, request.maxArticles)
    await post_job_callback(
        request,
        ScrapeJobCallback(jobId=request.jobId, status="running"),
    )

    try:
        result = await collect_articles(request.maxArticles)
    except Exception as error:
        logger.exception("Scrape job %s failed", request.jobId)
        await post_job_callback(
            request,
            ScrapeJobCallback(
                jobId=request.jobId,
                status="failed",
                errorMessage=str(error)[:1500],
            ),
        )
        return

    await post_job_callback(
        request,
        ScrapeJobCallback(
            jobId=request.jobId,
            status="succeeded",
            articles=result.articles,
        ),
    )
    logger.info("Completed WSJ scrape job %s with %s article(s)", request.jobId, len(result.articles))


@app.post("/jobs", dependencies=[Depends(require_secret)], status_code=202)
async def create_job(request: ScrapeJobRequest, background_tasks: BackgroundTasks) -> ScrapeJobAccepted:
    logger.info("Accepted WSJ scrape job %s max_articles=%s", request.jobId, request.maxArticles)
    background_tasks.add_task(run_scrape_job, request)
    return ScrapeJobAccepted(jobId=request.jobId, status="accepted")


@app.post("/audio/jobs", dependencies=[Depends(require_secret)], status_code=202)
async def create_audio_job(request: AudioJobRequest, background_tasks: BackgroundTasks) -> AudioJobAccepted:
    background_tasks.add_task(run_audio_job, request)
    return AudioJobAccepted(jobId=request.jobId, status="accepted")


@app.post("/scrape", dependencies=[Depends(require_secret)])
async def scrape(request: ScrapeRequest) -> ScrapeResult:
    logger.info("Running synchronous WSJ scrape max_articles=%s", request.maxArticles)
    return await collect_articles(request.maxArticles)
