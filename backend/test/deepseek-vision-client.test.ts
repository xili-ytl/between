import { describe, expect, it, vi } from "vitest";
import { HttpDeepSeekVisionClient } from "../src/adapters/deepseek-vision-client.js";

const request = [{ role: "system" as const, content: "rules" }, {
  role: "user" as const,
  content: [{ type: "text" as const, text: "hello" }, { type: "image_url" as const, image_url: { url: "data:image/png;base64,AQ==" } }]
}];

describe("HttpDeepSeekVisionClient", () => {
  it("posts the exact request and forwards its signal", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"reply":"你好","memoryUpdate":null}' } }] }), { status: 200 }));
    const signal = new AbortController().signal;
    const client = new HttpDeepSeekVisionClient("unit-test-key", "deepseek-vl", fetchFn);

    await expect(client.complete(request, signal)).resolves.toBe('{"reply":"你好","memoryUpdate":null}');

    // 思考模式开启：推理与回答共享输出预算，所以不设 max_tokens（默认 64K）；
    // temperature 在思考模式下不生效，必须不传，避免看起来像在调采样。
    expect(fetchFn).toHaveBeenCalledWith("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer unit-test-key", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-vl",
        messages: request,
        response_format: { type: "json_object" },
        thinking: { type: "enabled" },
        stream: false
      }),
      signal
    });
  });

  it("uses a generic provider error without reading non-OK private bodies", async () => {
    const text = vi.fn(async () => "do not expose private provider text");
    const fetchFn = vi.fn(async () => ({ ok: false, text } as unknown as Response));
    const client = new HttpDeepSeekVisionClient("unit-test-key", "model", fetchFn);
    await expect(client.complete(request, new AbortController().signal)).rejects.toThrow("Wenli vision request failed");
    expect(text).not.toHaveBeenCalled();
  });

  it.each(["not json", JSON.stringify({ choices: [{ message: { content: "  " } }] })])("rejects malformed or empty responses safely", async (body) => {
    const client = new HttpDeepSeekVisionClient("unit-test-key", "model", async () => new Response(body));
    await expect(client.complete(request, new AbortController().signal)).rejects.toThrow("Wenli vision response invalid");
  });

  it("rejects declared and streamed oversized response bodies", async () => {
    const declaredCancel = vi.fn(async () => undefined);
    const declared = new HttpDeepSeekVisionClient("unit-test-key", "model", async () => ({ ok: true, headers: new Headers({ "content-length": String(2 * 1024 * 1024 + 1) }), body: { cancel: declaredCancel } } as unknown as Response));
    await expect(declared.complete(request, new AbortController().signal)).rejects.toThrow("Wenli vision response too large");
    expect(declaredCancel).toHaveBeenCalledOnce();
    let cancelled = false;
    const reader = { read: vi.fn(async () => ({ done: false, value: new Uint8Array(2 * 1024 * 1024 + 1) })), cancel: vi.fn(async () => { cancelled = true; }) };
    const streamed = new HttpDeepSeekVisionClient("unit-test-key", "model", async () => ({ ok: true, headers: new Headers(), body: { getReader: () => reader } } as unknown as Response));
    await expect(streamed.complete(request, new AbortController().signal)).rejects.toThrow("Wenli vision response too large");
    expect(cancelled).toBe(true);
  });

  it("preserves caller aborts and rejects blank configuration", async () => {
    expect(() => new HttpDeepSeekVisionClient(" ", "model")).toThrow("invalid Wenli vision configuration");
    const controller = new AbortController(); controller.abort();
    const client = new HttpDeepSeekVisionClient("unit-test-key", "model", async () => { throw new Error("network private detail"); });
    await expect(client.complete(request, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels and releases an in-flight reader immediately when the caller aborts", async () => {
    let started!: () => void;
    const never = new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => { started = resolve as unknown as () => void; });
    const reader = { read: vi.fn(() => never), cancel: vi.fn(async () => undefined), releaseLock: vi.fn() };
    const controller = new AbortController();
    const client = new HttpDeepSeekVisionClient("unit-test-key", "model", async () => ({ ok: true, headers: new Headers(), body: { getReader: () => reader } } as unknown as Response));
    const pending = client.complete(request, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    void started;
  });
});
