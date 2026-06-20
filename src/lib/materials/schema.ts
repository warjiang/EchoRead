import type { TrainingMaterialPayload } from "@/lib/materials/types";

function ensureString(value: unknown, name: string, minLength = 1): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new Error(`${name} must have at least ${minLength} characters`);
  }
  return trimmed;
}

function ensureStringArray(value: unknown, name: string, minItems = 1): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  const result = value.map((item, index) => ensureString(item, `${name}[${index}]`));
  if (result.length < minItems) {
    throw new Error(`${name} must include at least ${minItems} items`);
  }
  return result;
}

function ensureObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parseAndValidateTrainingMaterialPayload(input: unknown): TrainingMaterialPayload {
  const root = ensureObject(input, "payload");

  const chunkedScriptInput = root.chunkedScript;
  if (!Array.isArray(chunkedScriptInput) || chunkedScriptInput.length === 0) {
    throw new Error("chunkedScript must be a non-empty array");
  }
  const chunkedScript = chunkedScriptInput.map((item, index) => {
    const row = ensureObject(item, `chunkedScript[${index}]`);
    return {
      sentence: ensureString(row.sentence, `chunkedScript[${index}].sentence`, 6),
      chunks: ensureStringArray(row.chunks, `chunkedScript[${index}].chunks`),
      pauseHints: ensureStringArray(row.pauseHints, `chunkedScript[${index}].pauseHints`),
      stressWords: ensureStringArray(row.stressWords, `chunkedScript[${index}].stressWords`),
    };
  });

  const simplifiedInput = ensureObject(root.simplifiedVersion, "simplifiedVersion");
  const simplifiedVersion = {
    cefrLevel: "B1-B2" as const,
    text: ensureString(simplifiedInput.text, "simplifiedVersion.text", 20),
  };

  const dictationInput = root.dictationExercises;
  if (!Array.isArray(dictationInput) || dictationInput.length === 0) {
    throw new Error("dictationExercises must be a non-empty array");
  }
  const dictationExercises = dictationInput.map((item, index) => {
    const row = ensureObject(item, `dictationExercises[${index}]`);
    return {
      prompt: ensureString(row.prompt, `dictationExercises[${index}].prompt`, 8),
      answer: ensureString(row.answer, `dictationExercises[${index}].answer`, 2),
    };
  });

  const clozeInput = root.clozeExercises;
  if (!Array.isArray(clozeInput) || clozeInput.length === 0) {
    throw new Error("clozeExercises must be a non-empty array");
  }
  const clozeExercises = clozeInput.map((item, index) => {
    const row = ensureObject(item, `clozeExercises[${index}]`);
    return {
      prompt: ensureString(row.prompt, `clozeExercises[${index}].prompt`, 8),
      answer: ensureString(row.answer, `clozeExercises[${index}].answer`, 2),
    };
  });

  const retellInput = root.retellOutline;
  if (!Array.isArray(retellInput) || retellInput.length === 0) {
    throw new Error("retellOutline must be a non-empty array");
  }
  const retellOutline = retellInput.map((item, index) => {
    const row = ensureObject(item, `retellOutline[${index}]`);
    return {
      point: ensureString(row.point, `retellOutline[${index}].point`, 8),
      connectors: ensureStringArray(row.connectors, `retellOutline[${index}].connectors`),
    };
  });

  const keywordInput = root.keywordPrompts;
  if (!Array.isArray(keywordInput) || keywordInput.length === 0) {
    throw new Error("keywordPrompts must be a non-empty array");
  }
  const keywordPrompts = keywordInput.map((item, index) => {
    const row = ensureObject(item, `keywordPrompts[${index}]`);
    return {
      keyword: ensureString(row.keyword, `keywordPrompts[${index}].keyword`, 2),
      prompt: ensureString(row.prompt, `keywordPrompts[${index}].prompt`, 8),
    };
  });

  return {
    chunkedScript,
    simplifiedVersion,
    dictationExercises,
    clozeExercises,
    retellOutline,
    keywordPrompts,
  };
}
