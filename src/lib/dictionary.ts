const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en";

export interface WordDefinition {
  word: string;
  phonetic?: string;
  phonetics: { text?: string; audio?: string }[];
  meanings: {
    partOfSpeech: string;
    definitions: {
      definition: string;
      example?: string;
    }[];
  }[];
}

export async function lookupWord(word: string): Promise<WordDefinition | null> {
  try {
    const res = await fetch(`${DICT_API}/${encodeURIComponent(word.toLowerCase())}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data[0] || null;
  } catch {
    return null;
  }
}
