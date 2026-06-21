import { buildRepairPrompt, buildTrainingPrompt, PROMPT_VERSION } from "@/lib/materials/prompt";
import { parseAndValidateTrainingMaterialPayload } from "@/lib/materials/schema";
import { createOpenAIJsonCompletion } from "@/lib/materials/openai";
import type { TrainingMaterialPayload } from "@/lib/materials/types";

const DEFAULT_MODEL = "gpt-4.1";

interface GenerationResult {
  payload: TrainingMaterialPayload;
  model: string;
  promptVersion: string;
}

class PayloadValidationError extends Error {
  rawResponse: string;

  constructor(message: string, rawResponse: string) {
    super(message);
    this.name = "PayloadValidationError";
    this.rawResponse = rawResponse;
  }
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```([\s\S]*?)```/);
  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("No JSON object found in model output");
}

function getConfiguredModel(): string {
  return process.env.LLM_MODEL_HIGH_QUALITY || DEFAULT_MODEL;
}

function assertProvider(): void {
  const provider = process.env.LLM_PROVIDER || "openai";
  if (provider !== "openai" && provider !== "openai-compatible") {
    throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
  }
}

async function generatePayloadOnce(prompt: string, model: string): Promise<{ payload: TrainingMaterialPayload; raw: string }> {
  const raw = await createOpenAIJsonCompletion(
    [
      {
        role: "system",
        content: "You produce valid JSON for language-learning materials.",
      },
      { role: "user", content: prompt },
    ],
    model
  );

  try {
    const parsed = extractJsonObject(raw);
    const payload = parseAndValidateTrainingMaterialPayload(parsed);
    return { payload, raw };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown validation error";
    throw new PayloadValidationError(message, raw);
  }
}

export async function generateTrainingPackage(article: { title: string; content: string }): Promise<GenerationResult> {
  assertProvider();
  const model = getConfiguredModel();

  const firstPrompt = buildTrainingPrompt(article);
  try {
    const first = await generatePayloadOnce(firstPrompt, model);
    return { payload: first.payload, model, promptVersion: PROMPT_VERSION };
  } catch (error) {
    if (!(error instanceof PayloadValidationError)) {
      throw error;
    }

    const repairPrompt = buildRepairPrompt(error.rawResponse, error.message);
    const repaired = await generatePayloadOnce(repairPrompt, model);
    return { payload: repaired.payload, model, promptVersion: PROMPT_VERSION };
  }
}
