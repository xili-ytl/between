import { AppError } from "../domain/errors.js";
import type { AiProvider } from "../ports/ai-provider.js";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/v1/chat/completions";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class DeepSeekAiProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 60_000
  ) {
    if (!apiKey.trim() || !model.trim()) {
      throw new AppError("AI_UNAVAILABLE", "AI service is not configured");
    }
  }

  async complete(input: {
    messages: Parameters<AiProvider["complete"]>[0]["messages"];
    maxTokens: number;
    temperature: number;
  }): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();

    try {
      const response = await this.fetchFn(DEEPSEEK_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          messages: input.messages,
          max_tokens: input.maxTokens,
          temperature: input.temperature,
          stream: false
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new AppError("AI_PROVIDER_ERROR", "AI provider request failed");
      }

      const body = await readBoundedBody(response, MAX_RESPONSE_BYTES);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch (_) {
        throw new AppError("AI_PROVIDER_ERROR", "AI provider returned an invalid response");
      }
      const content = assistantContent(parsed);
      if (!content) {
        throw new AppError("AI_PROVIDER_ERROR", "AI provider returned an empty response");
      }
      return content;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (controller.signal.aborted || isAbortError(error)) {
        throw new AppError("AI_TIMEOUT", "AI provider request timed out");
      }
      throw new AppError("AI_PROVIDER_ERROR", "AI provider request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedBody(response: Response, limit: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new AppError("AI_RESPONSE_TOO_LARGE", "AI provider response is too large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new AppError("AI_RESPONSE_TOO_LARGE", "AI provider response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function assistantContent(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content.trim() : "";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
