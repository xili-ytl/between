import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpDeepSeekWebSearch } from "../src/adapters/deepseek-web-search.js";

const clock = () => new Date("2026-09-11T17:00:00.000Z");
const signal = () => new AbortController().signal;
const item = (url = "https://example.org/announcement", title = "Official announcement") => ({ type: "web_search_result", url, title, page_age: "2026-09-12" });
const result = (items: unknown[] = [item()]) => ({ content: [
  { type: "thinking", thinking: "internal reasoning must never escape" },
  { type: "server_tool_use", name: "web_search" },
  { type: "web_search_tool_result", content: items },
  { type: "text", text: "Unsupported invented prose https://invented.example/", citations: [
    { url: "https://example.org/announcement", cited_text: "The official article describes a new release." },
    { url: "https://invented.example/", cited_text: "Do not promote this unmatched citation." }
  ] }
] });
const clientFor = (body: unknown) => new HttpDeepSeekWebSearch("unit-test-key", undefined, async () => Response.json(body), clock);

afterEach(() => vi.useRealTimers());

describe("HttpDeepSeekWebSearch", () => {
  it("retains successful sources when a later search attempt reaches its tool limit", async () => {
    const body=result();
    body.content.push({type:"web_search_tool_result",content:[{type:"web_search_tool_result_error",error_code:"max_uses_exceeded"}]} as never);
    const found=await clientFor(body).search("AI news",signal());
    expect(found.sources).toHaveLength(1);
  });
  it("sends only a public query and trusted date to the fixed official endpoint", async () => {
    const fetchFn = vi.fn(async () => Response.json(result()));
    const client = new HttpDeepSeekWebSearch("unit-test-key", undefined, fetchFn, clock);
    await client.search("AI official announcements", signal());
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({ "x-api-key": "unit-test-key", "anthropic-version": "2023-06-01", "Content-Type": "application/json", Accept: "application/json" });
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "tools"]);
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.max_tokens).toBe(4096);
    expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 1 }]);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content[0].text).toContain("AI official announcements");
    expect(body.messages[0].content[0].text).toContain("2026-09-12");
    expect(body.messages[0].content[0].text).toContain("Asia/Shanghai");
    expect(body.messages[0].content[0].text).not.toContain("unit-test-key");
  });

  it("returns structured sources with matching excerpts, never provider prose or reasoning", async () => {
    const found = await clientFor(result()).search("AI news", signal());
    expect(found.searched).toBe(true);
    expect(found.sources).toEqual([{ url: "https://example.org/announcement", title: "Official announcement", date: "2026-09-12", snippet: "The official article describes a new release." }]);
    expect(found.text).toContain("2026-09-11T17:00:00.000Z");
    expect(found.text).toContain("The official article describes a new release.");
    expect(found.text).not.toMatch(/invented|thinking|internal reasoning|Unsupported/);
  });

  it("retains an empty result as a completed search rather than fabricating sources", async () => {
    const found = await clientFor(result([])).search("AI news", signal());
    expect(found).toMatchObject({ searched: true, sources: [] });
    expect(found.text).not.toContain("invented");
  });

  it("deduplicates sources and caps them at six", async () => {
    const found = await clientFor(result([item(), item(), ...Array.from({ length: 10 }, (_, n) => item(`https://example.org/${n}`))])).search("AI news", signal());
    expect(found.sources).toHaveLength(6);
    expect(new Set(found.sources.map((source) => source.url)).size).toBe(6);
  });

  it.each([
    "http://localhost/a", "http://LOCALHOST./a", "http://foo.localhost/a", "http://localhost.localdomain/a", "http://router.home.arpa/a", "http://printer.local/a", "http://service.internal/a", "http://singlelabel/a", "https://example.org/\u0000",
    "http://127.1/a", "http://2130706433/a", "http://0x7f000001/a", "http://0.0.0.0/a", "http://10.0.0.1/a", "http://172.16.0.1/a", "http://192.168.1.1/a", "http://169.254.169.254/a", "http://100.64.0.1/a",
    "http://[::1]/a", "http://[::]/a", "http://[fc00::1]/a", "http://[fe80::1]/a", "http://[::ffff:127.0.0.1]/a", "http://[ff02::1]/a",
    "file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.org/a", "https://example.org:8443/a", "not a URL"
  ])("excludes non-public or unsafe source URLs: %s", async (url) => {
    const found = await clientFor(result([item(url), item()])).search("AI news", signal());
    expect(found.sources).toHaveLength(1);
    expect(found.sources[0]!.url).toBe("https://example.org/announcement");
  });

  it("preserves unknown dates and bounds field sizes without deriving dates from retrieval time", async () => {
    const found = await clientFor(result([{ type: "web_search_result", url: "https://example.org/date-unknown", title: "t".repeat(1000) }])).search("AI news", signal());
    expect(found.sources[0]!.date).toBeUndefined();
    expect(found.sources[0]!.title.length).toBeLessThanOrEqual(300);
  });

  it.each([
    { content: [{ type: "text", text: "I searched and found https://example.org/" }] },
    { content: [{ type: "server_tool_use", name: "web_search" }] }
  ])("rejects a response that did not execute search", async (body) => {
    await expect(clientFor(body).search("AI news", signal())).rejects.toMatchObject({ code: "WENLI_WEB_NOT_EXECUTED" });
  });

  it("distinguishes a native tool error from an empty result and hides provider detail", async () => {
    const body = { content: [{ type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "secret-provider-value" } }] };
    await expect(clientFor(body).search("AI news", signal())).rejects.toMatchObject({ code: "WENLI_WEB_TOOL_FAILED", message: "WENLI_WEB_TOOL_FAILED" });
  });

  it.each([null, [], { content: "invalid" }, { content: [{ type: "web_search_tool_result" }] }])("rejects malformed protocol envelopes", async (body) => {
    await expect(clientFor(body).search("AI news", signal())).rejects.toMatchObject({ code: "WENLI_WEB_RESPONSE_INVALID" });
  });

  it.each([[401, "WENLI_WEB_UNAUTHORIZED"], [429, "WENLI_WEB_RATE_LIMITED"], [500, "WENLI_WEB_REQUEST_FAILED"]])("keeps HTTP %s errors stable without reading private error bodies", async (status, code) => {
    const text = vi.fn(async () => "secret-provider-value");
    const json = vi.fn(async () => ({ secret: "secret-provider-value" }));
    const client = new HttpDeepSeekWebSearch("unit-test-key", undefined, async () => ({ ok: false, status, text, json, body: null }) as unknown as Response, clock);
    await expect(client.search("AI news", signal())).rejects.toMatchObject({ code, message: code });
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it("sanitizes malformed JSON and transport errors", async () => {
    const client = new HttpDeepSeekWebSearch("unit-test-key", undefined, async () => new Response("secret invalid json"), clock);
    await expect(client.search("AI news", signal())).rejects.toMatchObject({ code: "WENLI_WEB_RESPONSE_INVALID" });
    const failed = new HttpDeepSeekWebSearch("unit-test-key", undefined, async () => { throw new Error("secret transport detail"); }, clock);
    await expect(failed.search("AI news", signal())).rejects.toMatchObject({ code: "WENLI_WEB_REQUEST_FAILED", message: "WENLI_WEB_REQUEST_FAILED" });
  });

  it("rejects declared and actual bodies above 512 KiB", async () => {
    const declared = new HttpDeepSeekWebSearch("unit-test-key", undefined, async () => new Response("{}", { headers: { "content-length": String(512 * 1024 + 1) } }), clock);
    await expect(declared.search("AI news", signal())).rejects.toMatchObject({ code: "WENLI_WEB_RESPONSE_TOO_LARGE" });
    const oversized = new HttpDeepSeekWebSearch("unit-test-key", undefined, async () => new Response("x".repeat(512 * 1024 + 1)), clock);
    await expect(oversized.search("AI news", signal())).rejects.toMatchObject({ code: "WENLI_WEB_RESPONSE_TOO_LARGE" });
  });

  it("enforces a 20 second deadline even when fetch ignores cancellation", async () => {
    vi.useFakeTimers();
    let sentSignal: AbortSignal | undefined;
    const client = new HttpDeepSeekWebSearch("unit-test-key", undefined, (_url, init) => { sentSignal = init.signal as AbortSignal; return new Promise<Response>(() => {}); }, clock);
    const pending = client.search("AI news", signal());
    const checked = expect(pending).rejects.toMatchObject({ code: "WENLI_WEB_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(20_000);
    await checked;
    expect(sentSignal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves immediate caller cancellation without dispatch", async () => {
    const fetchFn = vi.fn();
    const controller = new AbortController(); controller.abort(new Error("private reason"));
    const client = new HttpDeepSeekWebSearch("unit-test-key", undefined, fetchFn, clock);
    await expect(client.search("AI news", controller.signal)).rejects.toMatchObject({ name: "AbortError", code: "WENLI_WEB_ABORTED", message: "WENLI_WEB_ABORTED" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("cancels a stalled response body without waiting on its cancellation promise", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const releaseLock = vi.fn();
    const reader = { read: () => new Promise(() => {}), cancel, releaseLock };
    const client = new HttpDeepSeekWebSearch("unit-test-key", undefined, async () => ({ ok: true, headers: new Headers(), body: { getReader: () => reader } }) as unknown as Response, clock);
    const controller = new AbortController();
    const pending = client.search("AI news", controller.signal);
    const checked = expect(pending).rejects.toMatchObject({ code: "WENLI_WEB_ABORTED" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await checked;
    expect(cancel).toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalled();
  });

  it("rejects empty credentials and unbounded queries without dispatch", async () => {
    expect(() => new HttpDeepSeekWebSearch(" ")).toThrow("WENLI_WEB_CONFIG_INVALID");
    const fetchFn = vi.fn();
    const client = new HttpDeepSeekWebSearch("unit-test-key", undefined, fetchFn, clock);
    for (const query of [" ", "x".repeat(501), "AI\u0000news"]) {
      await expect(client.search(query, signal())).rejects.toMatchObject({ code: "WENLI_WEB_QUERY_INVALID" });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
