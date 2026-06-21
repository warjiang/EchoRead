import asyncio
import unittest
from datetime import timezone
from unittest.mock import patch

from app.audio import align_sentences_to_words, build_audio_job_callback, extension_from_source, tokenize_words
from app.models import (
    AudioJobCallback,
    AudioJobRequest,
    AudioSentenceInput,
    AudioSource,
    WordTiming,
)
from app.scraper import (
    build_article_from_snapshot,
    normalize_article_url,
)


class ScraperTests(unittest.TestCase):
    def words(self, values: list[str], start: float = 0.0, step: float = 0.3) -> list[WordTiming]:
        return [
            WordTiming(word=value, start=start + (index * step), end=start + (index * step) + 0.18)
            for index, value in enumerate(values)
        ]

    def test_normalize_article_url_removes_query_and_fragment(self):
        self.assertEqual(
            normalize_article_url("https://www.wsj.com/articles/a-good-story-123?mod=hp#comments"),
            "https://www.wsj.com/articles/a-good-story-123",
        )

    def test_normalize_article_url_rejects_non_article_pages(self):
        self.assertIsNone(normalize_article_url("https://www.wsj.com/video/news"))
        self.assertIsNone(normalize_article_url("https://example.com/articles/story"))
        self.assertIsNone(normalize_article_url("https://www.wsj.com/tech/ai"))

    def test_normalize_article_url_accepts_modern_section_paths(self):
        self.assertEqual(
            normalize_article_url(
                "https://www.wsj.com/business/media/polymarket-social-media-bets-prediction-market-441cdeb5?mod=business_lead_story"
            ),
            "https://www.wsj.com/business/media/polymarket-social-media-bets-prediction-market-441cdeb5",
        )
        self.assertEqual(
            normalize_article_url("https://www.wsj.com/finance/investing/private-credit-d3661627"),
            "https://www.wsj.com/finance/investing/private-credit-d3661627",
        )

    def test_build_article_from_dom_paragraphs(self):
        article = build_article_from_snapshot(
            {
                "title": "Markets Rise as Investors Weigh Growth Outlook",
                "canonicalUrl": "https://www.wsj.com/articles/markets-rise-growth-outlook-123",
                "category": "Markets",
                "publishedAt": "2026-06-21T01:00:00Z",
                "paragraphs": [
                    "Markets rose Monday as investors weighed fresh economic data and company earnings.",
                    "The gains were broad, led by technology and industrial shares during morning trading.",
                    "Analysts said the latest numbers suggested demand remained resilient across sectors.",
                ],
                "jsonLd": [],
            },
            "https://www.wsj.com/articles/markets-rise-growth-outlook-123?mod=hp",
        )

        self.assertIsNotNone(article)
        assert article is not None
        self.assertEqual(article.title, "Markets Rise as Investors Weigh Growth Outlook")
        self.assertEqual(str(article.url), "https://www.wsj.com/articles/markets-rise-growth-outlook-123")
        self.assertEqual(article.category, "Markets")
        self.assertEqual(article.publishedAt.tzinfo, timezone.utc)
        self.assertIn("company earnings", article.content)

    def test_build_article_falls_back_to_json_ld_body(self):
        article = build_article_from_snapshot(
            {
                "title": "",
                "canonicalUrl": "https://www.wsj.com/articles/json-ld-story-123",
                "paragraphs": [],
                "jsonLd": [
                    {
                        "@type": "NewsArticle",
                        "headline": "A Long Enough Headline From Structured Data",
                        "articleBody": (
                            "This structured article body is long enough to pass validation. "
                            "It gives the scraper a stable fallback when paragraph selectors change."
                        ),
                        "datePublished": "2026-06-21T02:00:00Z",
                    }
                ],
            },
            "https://www.wsj.com/articles/json-ld-story-123",
        )

        self.assertIsNotNone(article)
        assert article is not None
        self.assertEqual(article.title, "A Long Enough Headline From Structured Data")
        self.assertIn("stable fallback", article.content)

    def test_build_article_skips_short_body(self):
        article = build_article_from_snapshot(
            {
                "title": "A Long Enough Headline But No Body",
                "canonicalUrl": "https://www.wsj.com/articles/short-body-123",
                "paragraphs": ["Too short."],
                "jsonLd": [],
            },
            "https://www.wsj.com/articles/short-body-123",
        )

        self.assertIsNone(article)

    def test_audio_extension_from_source(self):
        self.assertEqual(
            extension_from_source(AudioSource(url="https://example.com/audio/story.m4a")),
            ".m4a",
        )
        self.assertEqual(
            extension_from_source(AudioSource(url="https://example.com/audio/story", contentType="audio/mpeg")),
            ".mp3",
        )

    def test_tokenize_words_normalizes_sentence_text(self):
        self.assertEqual(tokenize_words("Stocks rose, didn't they?"), ["stocks", "rose", "didn't", "they"])
        self.assertEqual(tokenize_words("U.S. stocks beat U.K. shares."), ["us", "stocks", "beat", "uk", "shares"])

    def test_align_sentences_to_words_uses_sequential_timings(self):
        sentences = [
            AudioSentenceInput(id="s1", index=0, text="Stocks rose today."),
            AudioSentenceInput(id="s2", index=1, text="Markets closed higher."),
        ]
        words = [
            WordTiming(word="Stocks", start=0.1, end=0.4),
            WordTiming(word="rose", start=0.5, end=0.7),
            WordTiming(word="today", start=0.8, end=1.0),
            WordTiming(word="Markets", start=1.3, end=1.6),
            WordTiming(word="closed", start=1.7, end=2.0),
            WordTiming(word="higher", start=2.1, end=2.4),
        ]

        timings = align_sentences_to_words(sentences, words)

        self.assertEqual(len(timings), 2)
        self.assertEqual(timings[0].sentenceId, "s1")
        self.assertEqual(timings[1].sentenceId, "s2")
        self.assertLessEqual(timings[0].start, 0.1)
        self.assertGreater(timings[1].end, 2.4)
        self.assertGreaterEqual(timings[0].confidence, 0.9)

    def test_align_sentences_to_words_skips_audio_intro(self):
        sentences = [
            AudioSentenceInput(id="s1", index=0, text="Stocks rose today."),
            AudioSentenceInput(id="s2", index=1, text="Markets closed higher."),
        ]
        words = self.words(
            [
                "This",
                "is",
                "The",
                "Wall",
                "Street",
                "Journal.",
                "Here",
                "is",
                "your",
                "article.",
                "Stocks",
                "rose",
                "today.",
                "Markets",
                "closed",
                "higher.",
            ],
            start=1.0,
        )

        timings = align_sentences_to_words(sentences, words)

        self.assertEqual([timing.sentenceId for timing in timings], ["s1", "s2"])
        self.assertGreaterEqual(timings[0].start, 3.7)
        self.assertGreaterEqual(timings[0].confidence, 0.9)

    def test_align_sentences_to_words_tolerates_small_text_differences(self):
        sentences = [
            AudioSentenceInput(id="s1", index=0, text="The company said revenue rose sharply in the quarter."),
        ]
        words = self.words(["The", "company", "says", "revenue", "rose", "in", "the", "quarter."])

        timings = align_sentences_to_words(sentences, words)

        self.assertEqual(len(timings), 1)
        self.assertEqual(timings[0].sentenceId, "s1")
        self.assertGreaterEqual(timings[0].confidence, 0.62)

    def test_align_sentences_to_words_rejects_low_confidence_windows(self):
        sentences = [
            AudioSentenceInput(id="s1", index=0, text="Stocks rose today."),
            AudioSentenceInput(id="s2", index=1, text="Markets closed higher."),
        ]
        words = self.words(
            [
                "Weather",
                "forecasts",
                "called",
                "for",
                "heavy",
                "rain.",
                "Markets",
                "closed",
                "higher.",
            ]
        )

        timings = align_sentences_to_words(sentences, words)

        self.assertEqual([timing.sentenceId for timing in timings], ["s2"])

    def test_audio_callback_builder_returns_audio_callback(self):
        async def fake_process_audio_job(request):
            return AudioJobCallback(
                jobId=request.jobId,
                articleId=request.articleId,
                status="unavailable",
                errorMessage="No accessible WSJ article audio found",
            )

        with patch("app.audio.process_audio_job", side_effect=fake_process_audio_job):
            request = AudioJobRequest(
                jobId="job_123",
                articleId="article_123",
                articleUrl="https://www.wsj.com/articles/story-12345678",
                title="A Long Enough Article Title",
                sentences=[{"id": "s1", "index": 0, "text": "Stocks rose today."}],
                timeoutSeconds=300,
                coverageThreshold=0.9,
            )
            callback = asyncio.run(build_audio_job_callback(request))

        payload = callback.model_dump(mode="json")
        self.assertEqual(payload["jobId"], "job_123")
        self.assertEqual(payload["articleId"], "article_123")
        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["errorMessage"], "No accessible WSJ article audio found")
        self.assertEqual(payload["clips"], [])


if __name__ == "__main__":
    unittest.main()
