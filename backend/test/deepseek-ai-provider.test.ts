import { describe, expect, it, vi } from "vitest";
import { DeepSeekAiProvider } from "../src/adapters/deepseek-ai-provider.js";

const secret = "server-only-test-key";
const messages = [
  { role: "system" as const, content: "You are Wenli." },
  { role: "user" as const, content: "Hello" }
];

describe("DeepSeekAiProvider", () => {
  it("uses the server key and returns the trimmed assistant content", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "  你好呀  " } }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new DeepSeekAiProvider(secret, "deepseek-v4-flash", fetchFn);

    await expect(provider.complete({ messages, maxTokens: 512, temperature: 0.7 })).resolves.toBe("你好呀");

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${secret}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "deepseek-v4-flash",
      messages,
      max_tokens: 512,
      temperature: 0.7,
      stream: false
    });
  });

  it("rejects an empty server key at construction without echoing it", () => {
    expect(() => new DeepSeekAiProvider("", "deepseek-v4-flash")).toThrowError(
      expect.objectContaining({ code: "AI_UNAVAILABLE" })
    );
  });

  it("maps non-success responses to a secret-free provider error", async () => {
    const provider = new DeepSeekAiProvider(
      secret,
      "deepseek-v4-flash",
      async () => new Response(`upstream rejected ${secret}`, { status: 401 })
    );

    const error = await provider.complete({ messages, maxTokens: 100, temperature: 0 }).catch((value) => value);
    expect(error).toMatchObject({ code: "AI_PROVIDER_ERROR" });
    expect(String(error?.message)).not.toContain(secret);
  });

  it("aborts a slow request at the configured timeout", async () => {
    const fetchFn: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error(`aborted ${secret}`), { name: "AbortError" }));
      }, { once: true });
    });
    const provider = new DeepSeekAiProvider(secret, "deepseek-v4-flash", fetchFn, 5);

    const error = await provider.complete({ messages, maxTokens: 100, temperature: 0 }).catch((value) => value);
    expect(error).toMatchObject({ code: "AI_TIMEOUT" });
    expect(String(error?.message)).not.toContain(secret);
  });

  it("rejects a response body larger than two MiB before parsing it", async () => {
    const provider = new DeepSeekAiProvider(
      secret,
      "deepseek-v4-flash",
      async () => new Response("x".repeat(2 * 1024 * 1024 + 1), { status: 200 })
    );

    await expect(provider.complete({ messages, maxTokens: 100, temperature: 0 }))
      .rejects.toMatchObject({ code: "AI_RESPONSE_TOO_LARGE" });
  });

  it("rejects malformed or empty assistant output", async () => {
    const provider = new DeepSeekAiProvider(
      secret,
      "deepseek-v4-flash",
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }), { status: 200 })
    );

    await expect(provider.complete({ messages, maxTokens: 100, temperature: 0 }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
  });
});
