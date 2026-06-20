const OUTPUT_SCHEMA = `{
  "chunkedScript": [{"sentence": "...", "chunks": ["..."], "pauseHints": ["..."], "stressWords": ["..."]}],
  "simplifiedVersion": {"cefrLevel": "B1-B2", "text": "..."},
  "dictationExercises": [{"prompt": "...", "answer": "..."}],
  "clozeExercises": [{"prompt": "...", "answer": "..."}],
  "retellOutline": [{"point": "...", "connectors": ["..."]}],
  "keywordPrompts": [{"keyword": "...", "prompt": "..."}]
}`;

export const PROMPT_VERSION = "v1";

export function buildTrainingPrompt(article: { title: string; content: string }): string {
  return [
    "You are an expert shadow reading coach.",
    "Return valid JSON only.",
    "Create a complete training package from the article.",
    "Rules:",
    "- Keep language in English.",
    "- Keep quality high and pedagogically useful.",
    "- simplifiedVersion must be CEFR B1-B2.",
    "- chunkedScript should focus on rhythm, pauses, and stress words.",
    "- dictationExercises and clozeExercises should be answerable from the source text.",
    "- retellOutline should support 1-2 minute retelling.",
    "- keywordPrompts should include linking/weak-form/rhythm hints.",
    "- Provide at least 6 items for chunkedScript.",
    "- Provide at least 5 items for dictationExercises.",
    "- Provide at least 5 items for clozeExercises.",
    "- Provide at least 5 items for retellOutline.",
    "- Provide at least 8 items for keywordPrompts.",
    "JSON schema:",
    OUTPUT_SCHEMA,
    "Article title:",
    article.title,
    "Article content:",
    article.content,
  ].join("\n");
}

export function buildRepairPrompt(rawResponse: string, errorMessage: string): string {
  return [
    "You are repairing a malformed JSON response for a shadow reading training package.",
    "Return valid JSON only with the required schema and non-empty arrays.",
    "Validation error:",
    errorMessage,
    "Malformed response:",
    rawResponse,
    "Required JSON schema:",
    OUTPUT_SCHEMA,
  ].join("\n");
}
