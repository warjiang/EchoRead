export interface WsjAudioWordTiming {
  text: string;
  startMs: number | null;
  endMs: number | null;
  confidence?: number;
}

export interface LyricSentence {
  wsjAudioStatus: string;
  wsjAudioStartMs: number | null;
  wsjAudioEndMs: number | null;
  wsjAudioWords?: WsjAudioWordTiming[];
}

const MAX_AUDIO_MS = 24 * 60 * 60 * 1000;

function normalizeMs(value: unknown): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(MAX_AUDIO_MS, Math.trunc(parsed)));
}

function normalizeConfidence(value: unknown): number | undefined {
  if (value == null) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(1, parsed));
}

export function normalizeWsjAudioWords(input: unknown): WsjAudioWordTiming[] {
  if (!Array.isArray(input)) return [];

  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.text !== "string" || row.text.trim().length === 0) return [];

    const startMs = normalizeMs(row.startMs);
    const endMs = normalizeMs(row.endMs);
    const hasCompleteTiming = startMs != null && endMs != null && endMs >= startMs;

    return [{
      text: row.text.trim(),
      startMs: hasCompleteTiming ? startMs : null,
      endMs: hasCompleteTiming ? endMs : null,
      ...(normalizeConfidence(row.confidence) != null
        ? { confidence: normalizeConfidence(row.confidence) }
        : {}),
    }];
  });
}

export function parseWsjAudioWordsJson(value: string | null | undefined): WsjAudioWordTiming[] {
  if (!value) return [];
  try {
    return normalizeWsjAudioWords(JSON.parse(value));
  } catch {
    return [];
  }
}

export function serializeWsjAudioWords(value: unknown): string | null {
  const words = normalizeWsjAudioWords(value);
  return words.length > 0 ? JSON.stringify(words) : null;
}

export function serializeSentenceForArticleApi<T extends { wsjAudioWordsJson?: string | null }>(
  sentence: T
): Omit<T, "wsjAudioWordsJson"> & { wsjAudioWords: WsjAudioWordTiming[] } {
  const { wsjAudioWordsJson, ...rest } = sentence;
  return {
    ...rest,
    wsjAudioWords: parseWsjAudioWordsJson(wsjAudioWordsJson),
  };
}

export function sentenceHasTimedWords(sentence: LyricSentence | undefined): boolean {
  return Boolean(
    sentence?.wsjAudioWords?.some((word) => word.startMs != null && word.endMs != null)
  );
}

export function isLyricSentencePlayable(sentence: LyricSentence | undefined): boolean {
  return Boolean(
    sentence?.wsjAudioStatus === "ready" &&
      sentence.wsjAudioStartMs != null &&
      sentence.wsjAudioEndMs != null &&
      sentence.wsjAudioEndMs > sentence.wsjAudioStartMs &&
      sentenceHasTimedWords(sentence)
  );
}

export function hasLyricTimeline(sentences: LyricSentence[]): boolean {
  return sentences.some(isLyricSentencePlayable);
}

export function lyricPlayableIndices(sentences: LyricSentence[]): number[] {
  return sentences
    .map((sentence, index) => (isLyricSentencePlayable(sentence) ? index : -1))
    .filter((index) => index >= 0);
}

export function findFirstLyricSentenceIndex(sentences: LyricSentence[]): number {
  const first = lyricPlayableIndices(sentences)[0];
  return first ?? 0;
}

export function findNextLyricSentenceIndex(
  sentences: LyricSentence[],
  fromIndex: number
): number {
  return lyricPlayableIndices(sentences).find((index) => index > fromIndex) ?? fromIndex;
}

export function findPreviousLyricSentenceIndex(
  sentences: LyricSentence[],
  fromIndex: number
): number {
  return [...lyricPlayableIndices(sentences)].reverse().find((index) => index < fromIndex) ?? fromIndex;
}

export function findActiveLyricSentenceIndex(
  sentences: LyricSentence[],
  currentTimeMs: number,
  fallbackIndex = 0
): number {
  const index = sentences.findIndex(
    (sentence) =>
      isLyricSentencePlayable(sentence) &&
      sentence.wsjAudioStartMs != null &&
      sentence.wsjAudioEndMs != null &&
      currentTimeMs >= sentence.wsjAudioStartMs &&
      currentTimeMs <= sentence.wsjAudioEndMs
  );
  return index >= 0 ? index : fallbackIndex;
}

export function findActiveLyricWordIndex(
  words: WsjAudioWordTiming[] | undefined,
  currentTimeMs: number
): number {
  if (!words) return -1;
  return words.findIndex(
    (word) =>
      word.startMs != null &&
      word.endMs != null &&
      currentTimeMs >= word.startMs &&
      currentTimeMs <= word.endMs
  );
}
