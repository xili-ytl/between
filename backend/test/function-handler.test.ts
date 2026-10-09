import { describe, expect, it, vi } from "vitest";
import { createFunctionHandler, requestSource } from "../src/function-handler.js";

describe("CloudBase function handler", () => {
  it("uses the first forwarded address as the login-rate-limit source", async () => {
    const handle = vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } });
    const handler = createFunctionHandler({ handle });
    const event = {
      action: "system.health",
      payload: {},
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }
    };

    await expect(handler(event, {})).resolves.toEqual({ ok: true, data: { status: "ok" } });
    expect(handle).toHaveBeenCalledWith(event, "203.0.113.9");
  });

  it("falls back safely when CloudBase supplies no network address", () => {
    expect(requestSource({}, {})).toBe("unknown");
    expect(requestSource({}, { environment: { WX_CLIENTIP: "198.51.100.3" } })).toBe("198.51.100.3");
  });
});
