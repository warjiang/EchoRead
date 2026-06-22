from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


class ScrapedArticle(BaseModel):
    title: str = Field(min_length=10)
    url: HttpUrl
    content: str = Field(min_length=100)
    category: str | None = None
    publishedAt: datetime | None = None


class ScrapeResult(BaseModel):
    articles: list[ScrapedArticle] = Field(default_factory=list)


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
    timeoutSeconds: int = Field(default=300, ge=30, le=3600)
    coverageThreshold: float = Field(default=0.9, ge=0, le=1)


class AudioWordTimingCallback(BaseModel):
    text: str
    startMs: int | None = None
    endMs: int | None = None
    confidence: float | None = None


class AudioClipCallback(BaseModel):
    sentenceId: str
    audioUrl: str | None = None
    startMs: int | None = None
    endMs: int | None = None
    status: Literal["ready", "unavailable", "failed"] = "unavailable"
    words: list[AudioWordTimingCallback] = Field(default_factory=list)


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
    words: list[AudioWordTimingCallback] = Field(default_factory=list)
