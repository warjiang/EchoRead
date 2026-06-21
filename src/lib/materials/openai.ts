interface OpenAIMessage {
  role: "system" | "user";
  content: string;
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

function normalizeBaseUrl(rawBaseUrl: string | undefined): string {
  const baseUrl = rawBaseUrl || "https://api.openai.com/v1";
  return baseUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
}

function getApiKey(): string {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("LLM_API_KEY or OPENAI_API_KEY is required");
  }
  return apiKey;
}

export async function createOpenAIJsonCompletion(messages: OpenAIMessage[], model: string): Promise<string> {
  const apiKey = getApiKey();
  const baseUrl = normalizeBaseUrl(process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL);
  const responseFormat = process.env.LLM_RESPONSE_FORMAT || "json_object";
  const body: Record<string, unknown> = {
    model,
    temperature: Number(process.env.LLM_TEMPERATURE || "0.4"),
    messages,
  };

  if (responseFormat !== "none") {
    body.response_format = { type: responseFormat };
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as OpenAIResponse;
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI request failed with ${response.status}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI response did not include message content");
  }

  return content;
}
