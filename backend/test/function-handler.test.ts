import { afterEach, describe, expect, it, vi } from "vitest";
import { createFunctionHandler, requestSource } from "../src/function-handler.js";

describe("CloudBase function handler", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("passes the original business event and platform source to the router", async () => {
    const response = { ok: true, data: { status: "ok" } };
    const handle = vi.fn().mockResolvedValue(response);
    const handler = createFunctionHandler({ handle });
    const event = {
      action: "system.health",
      payload: {},
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }
    };
    const context = { environment: JSON.stringify({ TCB_SOURCE_IP: "198.51.100.3" }) };

    await expect(handler(event, context)).resolves.toBe(response);
    expect(handle).toHaveBeenCalledExactlyOnceWith(event, "198.51.100.3");
    expect(handle.mock.calls[0]?.[0]).toBe(event);
  });

  it("preserves a router rejection", async () => {
    const failure = new Error("synthetic router failure");
    const handler = createFunctionHandler({ handle: vi.fn().mockRejectedValue(failure) });

    await expect(handler({ action: "system.health", payload: {} }, {})).rejects.toBe(failure);
  });

  it("prefers the CloudBase source over WeChat addresses and event headers", () => {
    const context = {
      environment: {
        TCB_SOURCE_IP: "198.51.100.3",
        WX_CLIENTIP: "198.51.100.4",
        WX_CLIENTIPV6: "2001:db8::4"
      }
    };

    expect(requestSource({ headers: { "x-forwarded-for": "203.0.113.9" } }, context)).toBe("198.51.100.3");
  });

  it.each([
    { environment: { WX_CLIENTIP: "198.51.100.3" } },
    { environment: JSON.stringify({ WX_CLIENTIP: "198.51.100.3" }) },
    { environment: JSON.stringify({ TCB_SOURCE_IP: "198.51.100.3" }) },
    { environment: { TCB_SOURCE_IP: " 198.51.100.3 " } },
    { environ: "SCF_NAMESPACE=synthetic;TCB_SOURCE_IP=198.51.100.3" },
    { environment: "", environ: "SCF_NAMESPACE=synthetic;TCB_SOURCE_IP=198.51.100.3" }
  ])("reads the invocation's supported platform context %#", (context) => {
    expect(requestSource({}, context)).toBe("198.51.100.3");
  });

  it.each([
    { TCB_SOURCE_IP: "not-an-ip", WX_CLIENTIP: "198.51.100.3" },
    { TCB_SOURCE_IP: 123, WX_CLIENTIP: "198.51.100.3" },
    { TCB_SOURCE_IP: "", WX_CLIENTIP: "198.51.100.3" }
  ])("uses the next valid platform address when the preferred value is invalid %#", (environment) => {
    expect(requestSource({}, { environment })).toBe("198.51.100.3");
  });

  it.each([
    { TCB_SOURCE_IP: "2001:db8::3", WX_CLIENTIP: "198.51.100.4" },
    { WX_CLIENTIP: "not-an-ip", WX_CLIENTIPV6: " 2001:db8::3 " },
    { WX_CLIENTIPV6: "2001:db8::3" }
  ])("supports a valid IPv6 platform source %#", (environment) => {
    expect(requestSource({}, { environment })).toBe("2001:db8::3");
  });

  it.each([
    { environment: JSON.stringify({ TCB_SOURCE_IP: "198.51.100.3" }), expected: "198.51.100.3" },
    { environment: {}, expected: "unknown" },
    { environment: JSON.stringify({}), expected: "unknown" },
    { environment: "{broken-json", expected: "unknown" }
  ])("does not override the current environment with the legacy field %#", ({ environment, expected }) => {
    expect(requestSource({}, {
      environment,
      environ: "TCB_SOURCE_IP=203.0.113.9"
    })).toBe(expected);
  });

  it.each([
    { headers: { "x-forwarded-for": "203.0.113.9" } },
    { headers: { "X-Forwarded-For": "203.0.113.9, 198.51.100.3" } },
    { requestContext: { sourceIp: "203.0.113.9" } },
    { environment: { TCB_SOURCE_IP: "203.0.113.9" } }
  ])("does not derive a source from client-controlled event fields %#", (event) => {
    expect(requestSource(event, {})).toBe("unknown");
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { environment: "{broken-json" },
    { environment: "[]" },
    { environment: "null" },
    { environment: { TCB_SOURCE_IP: "198.51.100.3, 203.0.113.9" } },
    { environment: { WX_CLIENTIP: "256.1.1.1", WX_CLIENTIPV6: "invalid" } },
    { environ: "TCB_SOURCE_IP=invalid;missing-delimiter" }
  ])("uses unknown when the platform supplies no valid address %#", (context) => {
    expect(requestSource({}, context)).toBe("unknown");
  });

  it("does not use process environment values from another invocation", () => {
    vi.stubEnv("TCB_SOURCE_IP", "203.0.113.9");
    vi.stubEnv("WX_CLIENTIP", "203.0.113.10");

    expect(requestSource({}, {})).toBe("unknown");
  });
});
