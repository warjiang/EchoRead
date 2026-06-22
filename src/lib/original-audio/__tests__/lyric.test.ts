import test from "node:test";
import assert from "node:assert/strict";
import {
  findActiveLyricSentenceIndex,
  findActiveLyricWordIndex,
  findNextLyricSentenceIndex,
  findPreviousLyricSentenceIndex,
  hasLyricTimeline,
  normalizeWsjAudioWords,
  serializeSentenceForArticleApi,
  serializeWsjAudioWords,
  type LyricSentence,
} from "@/lib/original-audio/lyric";

const sentences: LyricSentence[] = [
  {
    wsjAudioStatus: "ready",
    wsjAudioStartMs: 1000,
    wsjAudioEndMs: 3000,
    wsjAudioWords: [
      { text: "stocks", startMs: 1000, endMs: 1500 },
      { text: "rose", startMs: 1600, endMs: 2100 },
      { text: "today", startMs: null, endMs: null },
    ],
  },
  {
    wsjAudioStatus: "unavailable",
    wsjAudioStartMs: null,
    wsjAudioEndMs: null,
    wsjAudioWords: [],
  },
  {
    wsjAudioStatus: "ready",
    wsjAudioStartMs: 4000,
    wsjAudioEndMs: 6000,
    wsjAudioWords: [{ text: "markets", startMs: 4100, endMs: 4500 }],
  },
];

test("normalizes WSJ audio word timing payloads", () => {
  assert.deepEqual(
    normalizeWsjAudioWords([
      { text: " Stocks ", startMs: 120.8, endMs: 300.2, confidence: 2 },
      { text: "untimed", startMs: "bad", endMs: 500 },
      { text: "" },
      null,
    ]),
    [
      { text: "Stocks", startMs: 120, endMs: 300, confidence: 1 },
      { text: "untimed", startMs: null, endMs: null },
    ]
  );
});

test("serializes sentence API shape without exposing raw timing JSON", () => {
  const serialized = serializeSentenceForArticleApi({
    id: "s1",
    text: "Stocks rose today.",
    wsjAudioWordsJson: serializeWsjAudioWords([{ text: "stocks", startMs: 100, endMs: 200 }]),
  });

  assert.equal("wsjAudioWordsJson" in serialized, false);
  assert.deepEqual(serialized.wsjAudioWords, [{ text: "stocks", startMs: 100, endMs: 200 }]);
});

test("finds active lyric sentence and word from source audio time", () => {
  assert.equal(hasLyricTimeline(sentences), true);
  assert.equal(findActiveLyricSentenceIndex(sentences, 1700), 0);
  assert.equal(findActiveLyricSentenceIndex(sentences, 4300), 2);
  assert.equal(findActiveLyricSentenceIndex(sentences, 3500, 0), 0);
  assert.equal(findActiveLyricWordIndex(sentences[0].wsjAudioWords, 1700), 1);
  assert.equal(findActiveLyricWordIndex(sentences[0].wsjAudioWords, 2500), -1);
});

test("skips unavailable sentences for previous and next controls", () => {
  assert.equal(findNextLyricSentenceIndex(sentences, 0), 2);
  assert.equal(findPreviousLyricSentenceIndex(sentences, 2), 0);
  assert.equal(findNextLyricSentenceIndex(sentences, 2), 2);
});
