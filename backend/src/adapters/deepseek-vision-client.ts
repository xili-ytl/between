import type { WenliTimingContext } from "../domain/wenli-timing.js";

export type DeepSeekVisionContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface DeepSeekVisionMessage {
  role: "system" | "user";
  content: string | DeepSeekVisionContentBlock[];
}

export interface WenliCompletionContext {
  privateSearchTexts?: readonly string[];
  allowSearch?: boolean;
  /** 本轮发问者账号；用于把同话题的检索证据按人隔离，避免串用另一位主人的结果。 */
  requesterId?: string;
  /** Optional, default-off diagnostics; contains no prompt or response text. */
  timing?: WenliTimingContext;
}
export interface DeepSeekVisionCompletionClient {
  readonly managesWebSearch?: boolean;
  complete(messages: DeepSeekVisionMessage[], signal: AbortSignal, context?: WenliCompletionContext): Promise<string>;
}

type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;
const ENDPOINT = "https://api.deepseek.com/chat/completions";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class HttpDeepSeekVisionClient implements DeepSeekVisionCompletionClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: FetchFunction = fetch
  ) {
    if (!apiKey.trim() || !model.trim()) throw new Error("invalid Wenli vision configuration");
  }

  async complete(messages: DeepSeekVisionMessage[], signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw abortError();
    let response: Response;
    try {
      response = await this.fetchFn(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          // 不再设置 max_tokens：思考模式下推理与回答共享预算，
          // 旧的 2000 会被推理吃掉导致 content 为空。不设置时思考模式默认 64K。
          response_format: { type: "json_object" },
          // 显式开启思考模式（API 默认也是 enabled，这里写明意图）
          thinking: { type: "enabled" },
          // 注意：思考模式下 temperature 不生效，故意不传
          stream: false
        }),
        signal
      });
    } catch {
      if (signal.aborted) throw abortError();
      throw new Error("Wenli vision request failed");
    }
    if (signal.aborted) throw abortError();
    if (!response.ok) throw new Error("Wenli vision request failed");
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
      await cancelBody(response.body);
      throw new Error("Wenli vision response too large");
    }
    let text: string;
    try {
      text = await readBoundedText(response, signal);
    } catch (error) {
      if (signal.aborted) throw abortError();
      throw error;
    }
    if (signal.aborted) throw abortError();
    try {
      const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new Error();
      return content.trim();
    } catch {
      throw new Error("Wenli vision response invalid");
    }
  }
}

export async function readBoundedText(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Wenli vision response invalid");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const next = await readWithAbort(reader, signal);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* Overflow is already known. */ }
        throw new Error("Wenli vision response too large");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (signal.aborted) {
      await cancelReader(reader);
      throw abortError();
    }
    if (error instanceof Error && error.message === "Wenli vision response too large") throw error;
    throw new Error("Wenli vision response invalid");
  } finally {
    reader.releaseLock?.();
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}

async function readWithAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => settle(() => reject(abortError()));
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (value) => settle(() => resolve(value)),
      (cause: unknown) => settle(() => reject(new Error(`Wenli vision response invalid${process.env.WENLI_OPENROUTER_DEBUG === "1" ? ` (read: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)})` : ""}`)))
    );
  });
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try { await reader.cancel(); } catch { /* The caller's abort is still authoritative. */ }
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try { await body?.cancel(); } catch { /* Declared overflow is still authoritative. */ }
}

function abortError(): Error {
  const error = new Error("Wenli vision request aborted");
  error.name = "AbortError";
  return error;
}
