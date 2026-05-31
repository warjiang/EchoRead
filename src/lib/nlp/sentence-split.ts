import nlp from "compromise";

export function splitIntoSentences(text: string): string[] {
  const doc = nlp(text);
  const sentences = doc.sentences().out("array") as string[];
  return sentences.filter((s) => s.trim().length > 0);
}
