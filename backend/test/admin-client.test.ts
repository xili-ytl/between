import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeAdmin } from "../scripts/admin-client.js";

describe("admin CloudBase client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("unwraps the standard CloudBase HTTP function response", async () => {
    vi.stubEnv("CLOUDBASE_FUNCTION_URL", "https://example.test/v1/functions/chat-api");
    vi.stubEnv("CLOUDBASE_PUBLISHABLE_KEY", "public-key");
    vi.stubEnv("BACKUP_ADMIN_TOKEN", "admin-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            result: JSON.stringify({ ok: true, data: { seeded: true } }),
            requestId: "request-1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(invokeAdmin<{ seeded: boolean }>("admin.seed", {})).resolves.toEqual({ seeded: true });
  });

  it("propagates a wrapped application error", async () => {
    vi.stubEnv("CLOUDBASE_FUNCTION_URL", "https://example.test/v1/functions/chat-api");
    vi.stubEnv("CLOUDBASE_PUBLISHABLE_KEY", "public-key");
    vi.stubEnv("BACKUP_ADMIN_TOKEN", "admin-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            result: JSON.stringify({
              ok: false,
              error: { code: "ADMIN_FORBIDDEN", message: "denied" },
            }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(invokeAdmin("admin.seed", {})).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
  });

  it("rejects a success envelope without data", async () => {
    vi.stubEnv("CLOUDBASE_FUNCTION_URL", "https://example.test/v1/functions/chat-api");
    vi.stubEnv("CLOUDBASE_PUBLISHABLE_KEY", "public-key");
    vi.stubEnv("BACKUP_ADMIN_TOKEN", "admin-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ result: JSON.stringify({ ok: true }) }), { status: 200 }),
      ),
    );

    await expect(invokeAdmin("admin.seed", {})).rejects.toMatchObject({ code: "CLOUD_RESPONSE_INVALID" });
  });

  it("rejects a failure envelope without a stable error", async () => {
    vi.stubEnv("CLOUDBASE_FUNCTION_URL", "https://example.test/v1/functions/chat-api");
    vi.stubEnv("CLOUDBASE_PUBLISHABLE_KEY", "public-key");
    vi.stubEnv("BACKUP_ADMIN_TOKEN", "admin-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ result: JSON.stringify({ ok: false, error: { code: 403, message: null } }) }),
          { status: 200 },
        ),
      ),
    );

    await expect(invokeAdmin("admin.seed", {})).rejects.toMatchObject({ code: "CLOUD_RESPONSE_INVALID" });
  });
});
