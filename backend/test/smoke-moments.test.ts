import { describe, expect, it, vi } from "vitest";
import { main } from "../scripts/smoke-moments.js";

const ENVIRONMENT = {
  CLOUDBASE_FUNCTION_URL: "https://example.test/v1/functions/chat-api",
  CLOUDBASE_PUBLISHABLE_KEY: "publishable-secret",
  BACKUP_ADMIN_TOKEN: "admin-secret",
  SMOKE_PASSWORD_1001: "password-1001",
  SMOKE_PASSWORD_1002: "password-1002"
};

describe("Moments production smoke logic", () => {
  it("runs the privacy flow, verifies storage cleanup, and never sends chat", async () => {
    const actions: string[] = [];
    let listCalls = 0;
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        sessionToken?: string;
        payload: Record<string, unknown>;
      };
      actions.push(request.action);
      const partner = "1001_smoke_run1_partner";
      const comment = "1002_smoke_run1_comment";
      switch (request.action) {
        case "auth.login":
          return cloudSuccess({
            accountId: request.payload.accountId,
            sessionToken: request.payload.accountId === "1001" ? "session-1001" : "session-1002"
          });
        case "moments.create": {
          const clientMomentId = String(request.payload.clientMomentId);
          return cloudSuccess({
            id: `1001_${clientMomentId}`,
            authorId: "1001",
            visibility: request.payload.visibility,
            likes: [],
            comments: []
          });
        }
        case "moments.list":
          listCalls += 1;
          if (listCalls === 2) return cloudSuccess([{ id: partner, likes: [], comments: [] }]);
          if (listCalls === 3) {
            return cloudSuccess([{
              id: partner,
              likes: [{ accountId: "1002" }],
              comments: [{ id: comment, authorId: "1002" }]
            }]);
          }
          return cloudSuccess([]);
        case "moments.like":
          if (request.payload.momentId === "1001_smoke_run1_self") {
            return cloudFailure("MOMENT_NOT_FOUND", "hidden");
          }
          return cloudSuccess({ id: `${partner}_1002`, momentId: partner, accountId: "1002" });
        case "moments.comments.create":
          if (request.payload.momentId === "1001_smoke_run1_self") {
            return cloudFailure("MOMENT_NOT_FOUND", "hidden");
          }
          return cloudSuccess({ id: comment, momentId: partner, authorId: "1002" });
        case "admin.exportPage":
          expect(request.payload.adminToken).toBe("admin-secret");
          return cloudSuccess({ entries: [], nextCursor: null });
        case "moments.delete":
          if (request.sessionToken === "session-1002" && request.payload.momentId === partner) {
            return cloudFailure("MOMENT_FORBIDDEN", "not owner");
          }
          return cloudSuccess({ deleted: true });
        case "moments.comments.delete":
        case "auth.logout":
          return cloudSuccess({ deleted: true });
        default:
          return cloudFailure("ACTION_INVALID", "unexpected action");
      }
    });
    const output = vi.fn();

    await main({ environment: { ...ENVIRONMENT }, fetch, output, uniqueSuffix: () => "run1" });

    expect(actions).toEqual([
      "auth.login", "auth.login",
      "moments.create", "moments.list", "moments.like", "moments.comments.create", "moments.delete",
      "moments.create", "moments.list", "moments.delete", "moments.like", "moments.comments.create", "moments.list",
      "moments.comments.delete", "moments.delete", "moments.list", "moments.list",
      "admin.exportPage", "admin.exportPage", "admin.exportPage",
      "moments.comments.delete", "moments.delete", "moments.delete", "auth.logout", "auth.logout"
    ]);
    expect(actions).not.toContain("chat.send");
    expect(output).toHaveBeenCalledWith("Moments smoke check passed and cleaned up.\n");
    const logged = output.mock.calls.flat().join("\n");
    for (const secret of Object.values(ENVIRONMENT)) expect(logged).not.toContain(secret);
  });

  it("runs best-effort cleanup and logout after a mid-flow failure", async () => {
    const actions: string[] = [];
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { action: string; payload: Record<string, unknown> };
      actions.push(request.action);
      if (request.action === "auth.login") {
        return cloudSuccess({
          accountId: request.payload.accountId,
          sessionToken: request.payload.accountId === "1001" ? "session-1001" : "session-1002"
        });
      }
      if (request.action === "moments.create") return cloudSuccess({ id: "1001_smoke_run1_self" });
      if (request.action === "moments.list") return cloudFailure("SMOKE_FAILURE", "stop");
      return cloudSuccess({ deleted: true });
    });

    await expect(main({
      environment: { ...ENVIRONMENT },
      fetch,
      output: vi.fn(),
      uniqueSuffix: () => "run1"
    })).rejects.toMatchObject({ code: "SMOKE_FAILURE" });
    expect(actions.slice(-5)).toEqual([
      "moments.comments.delete", "moments.delete", "moments.delete", "auth.logout", "auth.logout"
    ]);
    expect(actions).not.toContain("chat.send");
  });

  it("preserves the primary smoke failure when cleanup also fails", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { action: string; payload: Record<string, unknown> };
      if (request.action === "auth.login") {
        return cloudSuccess({
          accountId: request.payload.accountId,
          sessionToken: request.payload.accountId === "1001" ? "session-1001" : "session-1002"
        });
      }
      if (request.action === "moments.create") return cloudSuccess({ id: "1001_smoke_run1_self" });
      if (request.action === "moments.list") return cloudFailure("SMOKE_FAILURE", "primary");
      if (request.action === "moments.comments.delete") return cloudFailure("CLEANUP_FAILURE", "cleanup");
      return cloudSuccess({ deleted: true });
    });

    const failure = await main({
      environment: { ...ENVIRONMENT },
      fetch,
      output: vi.fn(),
      uniqueSuffix: () => "run1"
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors[0]).toMatchObject({ code: "SMOKE_FAILURE" });
    expect((failure as AggregateError).errors[1]).toMatchObject({ code: "CLEANUP_FAILURE" });
  });

  it("reports a standalone cleanup failure only after a successful smoke flow", async () => {
    let listCalls = 0;
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        action: string;
        sessionToken?: string;
        payload: Record<string, unknown>;
      };
      const privateMoment = "1001_smoke_run1_self";
      const partnerMoment = "1001_smoke_run1_partner";
      const comment = "1002_smoke_run1_comment";
      if (request.action === "auth.login") {
        return cloudSuccess({ sessionToken: request.payload.accountId === "1001" ? "session-1001" : "session-1002" });
      }
      if (request.action === "moments.create") {
        return cloudSuccess({ id: `1001_${String(request.payload.clientMomentId)}` });
      }
      if (request.action === "moments.list") {
        listCalls += 1;
        if (listCalls === 2) return cloudSuccess([{ id: partnerMoment, likes: [], comments: [] }]);
        if (listCalls === 3) {
          return cloudSuccess([{
            id: partnerMoment,
            likes: [{ accountId: "1002" }],
            comments: [{ id: comment, authorId: "1002" }]
          }]);
        }
        return cloudSuccess([]);
      }
      if (request.action === "moments.like" && request.payload.momentId === privateMoment) {
        return cloudFailure("MOMENT_NOT_FOUND", "hidden");
      }
      if (request.action === "moments.comments.create" && request.payload.momentId === privateMoment) {
        return cloudFailure("MOMENT_NOT_FOUND", "hidden");
      }
      if (request.action === "moments.delete" && request.sessionToken === "session-1002") {
        return cloudFailure("MOMENT_FORBIDDEN", "not owner");
      }
      if (request.action === "moments.comments.create") return cloudSuccess({ id: comment });
      if (request.action === "admin.exportPage") return cloudSuccess({ entries: [], nextCursor: null });
      if (request.action === "auth.logout" && request.sessionToken === "session-1002") {
        return cloudFailure("CLEANUP_FAILURE", "logout cleanup");
      }
      return cloudSuccess({ deleted: true });
    });

    await expect(main({
      environment: { ...ENVIRONMENT },
      fetch,
      output: vi.fn(),
      uniqueSuffix: () => "run1"
    })).rejects.toMatchObject({ code: "SMOKE_CLEANUP_FAILED" });
  });
});

function cloudSuccess(data: unknown): Response {
  return new Response(JSON.stringify({ result: JSON.stringify({ ok: true, data }) }), { status: 200 });
}

function cloudFailure(code: string, message: string): Response {
  return new Response(JSON.stringify({ result: JSON.stringify({ ok: false, error: { code, message } }) }), {
    status: 200
  });
}
