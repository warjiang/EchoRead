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
  diagnostic: string;

  constructor(message: string, rawResponse: string, diagnostic?: string) {
    super(message);
    this.name = "PayloadValidationError";
    this.rawResponse = rawResponse;
    this.diagnostic = diagnostic || message;
  }
}

function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let column = 1;
  for (let i = 0; i < safeOffset; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function parseErrorPosition(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/position\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function excerptAround(text: string, offset: number): string {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const start = Math.max(0, safeOffset - 360);
  const end = Math.min(text.length, safeOffset + 360);
  const prefix = start > 0 ? "... " : "";
  const suffix = end < text.length ? " ..." : "";
  const excerpt = text.slice(start, end);
  const marker = `${" ".repeat(prefix.length + Math.max(0, safeOffset - start))}^`;
  return `${prefix}${excerpt}${suffix}\n${marker}`;
}

function formatJsonDiagnostic(input: {
  phase: string;
  error: unknown;
  rawResponse: string;
  jsonText: string;
  jsonOffset: number;
}): string {
  const baseMessage = input.error instanceof Error ? input.error.message : String(input.error);
  const relativePosition = parseErrorPosition(input.error);
  const absolutePosition = relativePosition == null ? input.jsonOffset : input.jsonOffset + relativePosition;
  const { line, column } = lineColumnAt(input.rawResponse, absolutePosition);
  return [
    `Material JSON ${input.phase} failed: ${baseMessage}`,
    `Raw response length: ${input.rawResponse.length} chars; JSON slice: ${input.jsonText.length} chars; raw offset: ${absolutePosition}; line ${line}, column ${column}.`,
    "Response excerpt near error:",
    excerptAround(input.rawResponse, absolutePosition),
  ].join("\n");
}

function parseJsonWithDiagnostics(jsonText: string, rawResponse: string, jsonOffset: number, phase: string): unknown {
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const diagnostic = formatJsonDiagnostic({ phase, error, rawResponse, jsonText, jsonOffset });
    throw new PayloadValidationError(diagnostic, rawResponse, diagnostic);
  }
}

export function extractJsonObject(text: string, phase: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const offset = text.indexOf(trimmed);
    return parseJsonWithDiagnostics(trimmed, text, offset, phase);
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```([\s\S]*?)```/);
  if (fencedMatch?.[1]) {
    const jsonText = fencedMatch[1].trim();
    const offset = text.indexOf(jsonText);
    return parseJsonWithDiagnostics(jsonText, text, Math.max(0, offset), phase);
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const trimmedOffset = text.indexOf(trimmed);
    const jsonOffset = Math.max(0, trimmedOffset) + firstBrace;
    return parseJsonWithDiagnostics(trimmed.slice(firstBrace, lastBrace + 1), text, jsonOffset, phase);
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

async function generatePayloadOnce(
  prompt: string,
  model: string,
  phase: "initial generation" | "repair generation"
): Promise<{ payload: TrainingMaterialPayload; raw: string }> {
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
    const parsed = extractJsonObject(raw, phase);
    const payload = parseAndValidateTrainingMaterialPayload(parsed);
    return { payload, raw };
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unknown validation error";
    const diagnostic = [
      `Material JSON ${phase} failed: ${message}`,
      `Raw response length: ${raw.length} chars.`,
      "Response excerpt:",
      excerptAround(raw, 0),
    ].join("\n");
    throw new PayloadValidationError(diagnostic, raw, diagnostic);
  }
}

export async function generateTrainingPackage(article: { title: string; content: string }): Promise<GenerationResult> {
  assertProvider();
  const model = getConfiguredModel();

  const firstPrompt = buildTrainingPrompt(article);
  try {
    const first = await generatePayloadOnce(firstPrompt, model, "initial generation");
    return { payload: first.payload, model, promptVersion: PROMPT_VERSION };
  } catch (error) {
    if (!(error instanceof PayloadValidationError)) {
      throw error;
    }

    const repairPrompt = buildRepairPrompt(error.rawResponse, error.diagnostic);
    try {
      const repaired = await generatePayloadOnce(repairPrompt, model, "repair generation");
      return { payload: repaired.payload, model, promptVersion: PROMPT_VERSION };
    } catch (repairError) {
      if (repairError instanceof PayloadValidationError) {
        throw new Error([
          "Training material generation failed after repair.",
          "Initial failure:",
          error.diagnostic,
          "Repair failure:",
          repairError.diagnostic,
        ].join("\n\n"));
      }
      throw repairError;
    }
  }
}
