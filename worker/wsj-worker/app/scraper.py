import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse

from playwright.async_api import BrowserContext, Error as PlaywrightError, Page, TimeoutError as PlaywrightTimeoutError, async_playwright

from app.config import WSJ_ARTICLE_SECTION_ROOTS, WSJ_HOME_URL, WSJ_SOURCE_URLS, logger
from app.models import ScrapedArticle, ScrapeResult


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
    import os

    cdp_url = os.environ.get("BROWSER_CDP_URL", "http://chrome:9222")
    max_candidates = max(20, max_articles * 8)
    candidate_urls: list[str] = []
    seen_candidates: set[str] = set()
    logger.info("Starting WSJ collection max_articles=%s cdp_url=%s", max_articles, cdp_url)

    async with async_playwright() as playwright:
        try:
            browser = await playwright.chromium.connect_over_cdp(cdp_url)
        except PlaywrightError as error:
            raise RuntimeError(
                f"Failed to connect to BROWSER_CDP_URL={cdp_url}. "
                "Use http://127.0.0.1:9222 or your external CDP endpoint for a local worker; "
                "http://chrome:9222 only works inside Docker Compose."
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
        raise RuntimeError(f"No valid WSJ articles collected from {len(candidate_urls)} candidate links")

    logger.info("Finished WSJ collection with %s article(s)", len(articles))
    return ScrapeResult(articles=articles)
