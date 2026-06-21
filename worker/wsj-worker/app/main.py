import os
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Annotated, Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen

from browser_use import Agent, Browser, ChatOpenAI
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, HttpUrl


logger = logging.getLogger(__name__)


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


app = FastAPI(title="EchoRead WSJ Worker")


def normalize_base_url(raw_base_url: str | None) -> str | None:
    if not raw_base_url:
        return None
    return raw_base_url.removesuffix("/chat/completions").rstrip("/")


def use_prompt_json_response_format() -> bool:
    response_format = os.environ.get("BROWSER_AGENT_RESPONSE_FORMAT", "prompt_json").strip().lower()
    return response_format in {"prompt_json", "prompt-json", "prompt", "none"}


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


async def collect_articles(max_articles: int) -> ScrapeResult:
    cdp_url = os.environ.get("BROWSER_CDP_URL", "http://chrome:9222")
    model = os.environ.get("BROWSER_AGENT_MODEL", "gpt-4.1-mini")
    api_key = os.environ.get("BROWSER_AGENT_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = normalize_base_url(os.environ.get("BROWSER_AGENT_BASE_URL") or os.environ.get("OPENAI_BASE_URL"))
    prompt_json_response = use_prompt_json_response_format()

    if not api_key:
        raise HTTPException(status_code=500, detail="BROWSER_AGENT_API_KEY or OPENAI_API_KEY is required")

    task = f"""
You are collecting WSJ articles for an English shadow-reading app.

Use the already-authenticated browser profile. Go to https://www.wsj.com/ and collect up to {max_articles} recent article pages.

For each article:
- open the real WSJ article page
- extract the visible title, canonical URL, article body text, category if present, and publication time if visible
- content must be the clean article body only, not navigation, ads, comments, or unrelated links
- skip videos, live blogs, market tickers, galleries, and pages with less than 100 characters of article body
- deduplicate by URL

Return only structured output matching the schema.
"""

    browser = Browser(cdp_url=cdp_url)
    llm = ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=base_url,
        add_schema_to_system_prompt=prompt_json_response,
        dont_force_structured_output=prompt_json_response,
    )
    agent = Agent(
        task=task,
        browser=browser,
        llm=llm,
        output_model_schema=ScrapeResult,
    )

    history = await agent.run(max_steps=int(os.environ.get("BROWSER_AGENT_MAX_STEPS", "80")))
    result = history.structured_output or history.get_structured_output(ScrapeResult)
    if not result:
        raise HTTPException(status_code=502, detail="Browser agent did not return structured output")

    articles: list[ScrapedArticle] = []
    seen: set[str] = set()
    for article in result.articles:
        url = str(article.url)
        if url in seen:
            continue
        seen.add(url)
        articles.append(
            ScrapedArticle(
                title=article.title.strip(),
                url=article.url,
                content=article.content.strip(),
                category=article.category.strip() if article.category else None,
                publishedAt=article.publishedAt or datetime.now(timezone.utc),
            )
        )

    return ScrapeResult(articles=articles[: max_articles])


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
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        logger.exception("Failed to post scrape job callback for %s: %s", request.jobId, error)


async def run_scrape_job(request: ScrapeJobRequest) -> None:
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


@app.post("/jobs", dependencies=[Depends(require_secret)], status_code=202)
async def create_job(request: ScrapeJobRequest, background_tasks: BackgroundTasks) -> ScrapeJobAccepted:
    background_tasks.add_task(run_scrape_job, request)
    return ScrapeJobAccepted(jobId=request.jobId, status="accepted")


@app.post("/scrape", dependencies=[Depends(require_secret)])
async def scrape(request: ScrapeRequest) -> ScrapeResult:
    return await collect_articles(request.maxArticles)
