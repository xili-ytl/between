import { beforeEach, describe, expect, it, vi } from "vitest";

const { app, createCollection, handle } = vi.hoisted(() => {
  const createCollection = vi.fn().mockResolvedValue({});
  return {
    app: { database: vi.fn(() => ({ createCollection })) },
    createCollection,
    handle: vi.fn()
  };
});

vi.mock("@cloudbase/node-sdk", () => ({
  SYMBOL_CURRENT_ENV: "isolated-test-env",
  init: vi.fn(() => app)
}));

vi.mock("../src/app-factory.js", () => ({
  createApiRouter: vi.fn(() => ({ handle }))
}));

import { main } from "../src/function-entry.js";

describe("CloudBase function entry", () => {
  beforeEach(() => {
    createCollection.mockReset().mockResolvedValue({});
    handle.mockReset();
  });

  it("serves repeated health requests without creating database collections", async () => {
    const response = { ok: true, data: { status: "ok" } };
    const event = { action: "system.health", payload: {} };
    handle.mockResolvedValue(response);

    await expect(main(event, {})).resolves.toEqual(response);
    await expect(main(event, {})).resolves.toEqual(response);

    expect(handle).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenCalledWith(event, "unknown");
    expect(createCollection).not.toHaveBeenCalled();
  });

  it("forwards repeated business requests without creating database collections", async () => {
    const event = {
      action: "chat.after",
      sessionToken: "synthetic-session",
      payload: { cursor: null, limit: 20 }
    };
    const response = { ok: true, data: { messages: [], nextCursor: null } };
    const context = { environment: { WX_CLIENTIP: "198.51.100.3" } };
    handle.mockResolvedValue(response);

    await expect(main(event, context)).resolves.toEqual(response);
    await expect(main(event, context)).resolves.toEqual(response);

    expect(handle).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenCalledWith(event, "198.51.100.3");
    expect(createCollection).not.toHaveBeenCalled();
  });

  it("preserves business error responses without attempting database setup", async () => {
    const response = { ok: false, error: { code: "SESSION_INVALID", message: "会话已失效" } };
    handle.mockResolvedValue(response);

    await expect(main({ action: "chat.after", payload: {} }, {})).resolves.toEqual(response);

    expect(createCollection).not.toHaveBeenCalled();
  });

  it("propagates a rejected business request without attempting database setup", async () => {
    const failure = new Error("isolated business failure");
    handle.mockRejectedValue(failure);

    await expect(main({ action: "chat.after", payload: {} }, {})).rejects.toBe(failure);

    expect(createCollection).not.toHaveBeenCalled();
  });
});
