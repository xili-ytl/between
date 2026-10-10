import type { CloudBase } from "@cloudbase/node-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiRouter } from "../src/app-factory.js";
import type { CloudPersistence, DocumentData } from "../src/adapters/cloudbase-stores.js";
import { hashSessionToken } from "../src/security/session.js";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Wenli actual app factory wiring with isolated CloudBase", () => {
  it("authenticates, claims, reads post/comment/image evidence and durably replies exactly once", async () => {
    vi.stubEnv("WENLI_MOBILE_SHADOW_ENABLED", "1");
    vi.stubEnv("WENLI_LLM_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-key");
    vi.stubEnv("JPUSH_APP_KEY", "");
    vi.stubEnv("JPUSH_MASTER_SECRET", "");
    const db = new IsolatedCloud();
    const now = new Date().toISOString();
    const token = "synthetic-only-no-real-session";
    for (const accountId of ["1002", "1001"]) db.put("users", accountId, { accountId, displayName: accountId === "1002" ? "示例甲" : "示例乙",
      gender: accountId === "1002" ? "男" : "女", avatarKey: null, profileInitializedVersion: 1, passwordHash: "unused",
      sessionHash: accountId === "1002" ? hashSessionToken(token) : null, sessionVersion: 1, updatedAt: now });
    const source = { id: "1002_eval", clientMessageId: "eval", senderId: "1002", recipientId: "1001", relationshipId: "couple",
      body: "@小Q 朋友圈里我发的红色书签照片，示例乙评论了什么？", createdAt: now };
    db.put("messages", source.id, source);
    db.put("wenliAgentJobs", source.id, { id: source.id, type: "mention", requesterId: "1002", sourceMessageId: source.id,
      status: "pending", attemptCount: 0, nextAttemptAt: now, createdAt: now, updatedAt: now });
    db.put("moments", "1002_bookmark", { id: "1002_bookmark", authorId: "1002", clientMomentId: "bookmark", body: "红色书签", visibility: "PARTNER", deleting: false,
      imageFileId: "cloud://synthetic/moments-images/1002_bookmark.png", imageMimeType: "image/png", createdAt: now });
    db.put("momentComments", "1001_comment", { id: "1001_comment", authorId: "1001", clientCommentId: "comment", momentId: "1002_bookmark", body: "书签是我做的", createdAt: now });
    const readPosts = vi.fn(async () => db.rows("moments"));
    const readComments = vi.fn(async (_collection: string, ids: string[], limit?: number) => db.rows("momentComments").filter(row => ids.includes(String(row.momentId))).slice(0, limit));
    const download = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const cloud = {
      getDocument: async (collection: string, id: string) => db.get(collection, id),
      findOne: async (collection: string, condition: DocumentData) => db.rows(collection).find(row => Object.entries(condition).every(([field, value]) => row[field] === value)) ?? null,
      queryMessages: async () => [], queryWenliMemories: async () => [],
      queryLatestVisibleMoments: readPosts, queryMomentRelations: readComments, downloadFile: download,
      putIfAbsent: async (collection: string, id: string, data: DocumentData) => { const existing = db.get(collection, id); if (existing) return existing; db.put(collection, id, data); return data; }
    } as unknown as CloudPersistence;
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request.model).toBe("xiaomi/mimo-v2.6-flash");
      expect(request.tools).toBeUndefined();
      const content = request.messages.at(-1).content;
      expect(content[0].text).toContain('"type":"original_post"');
      expect(content[0].text).toContain('"authorId":"1001"');
      expect(content[0].text).toContain("书签是我做的");
      expect(content.some((block: { type: string }) => block.type === "image_url")).toBe(true);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: "示例乙主人说：“书签是我做的” ^ ^", memoryUpdate: null }), }, finish_reason: "stop" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchFn);
    const router = createApiRouter(cloud, db as unknown as CloudBase);
    const request = { action: "wenli.kick", sessionToken: token, payload: { sourceMessageId: source.id } };
    await expect(router.handle(request, "synthetic-test")).resolves.toMatchObject({ ok: true, data: { processed: true } });
    await expect(router.handle(request, "synthetic-test")).resolves.toMatchObject({ ok: true, data: { processed: true } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(readPosts).toHaveBeenCalledExactlyOnceWith("1002", 100);
    expect(readComments).toHaveBeenCalledExactlyOnceWith("momentComments", ["1002_bookmark"], 8);
    expect(download).toHaveBeenCalledExactlyOnceWith("cloud://synthetic/moments-images/1002_bookmark.png");
    expect(db.rows("messages").filter(row => row.senderId === "wenli")).toMatchObject([{ sourceMessageId: source.id, body: "示例乙主人说：“书签是我做的” ^ ^" }]);
    expect(db.get("wenliAgentJobs", source.id)).toMatchObject({ status: "succeeded", attemptCount: 1 });
  });
});

class IsolatedCloud {
  private readonly collections = new Map<string, Map<string, DocumentData>>();
  get(collection: string, id: string): DocumentData | null { return structuredClone(this.collections.get(collection)?.get(id) ?? null); }
  put(collection: string, id: string, data: DocumentData) {
    let rows = this.collections.get(collection);
    if (!rows) { rows = new Map(); this.collections.set(collection, rows); }
    rows.set(id, structuredClone(data));
  }
  rows(collection: string): DocumentData[] { return [...(this.collections.get(collection)?.values() ?? [])].map(row => structuredClone(row)); }
  database() {
    const collection = (name: string) => ({ doc: (id: string) => ({
      get: async () => { const data = this.get(name, id); return { data: data ? { _id: id, ...data } : null }; },
      set: async (data: DocumentData) => { this.put(name, id, data); return {}; },
      update: async (data: DocumentData) => { this.put(name, id, { ...this.get(name, id), ...data }); return {}; }
    }) });
    return { collection, runTransaction: async <T>(fn: (transaction: { collection: typeof collection }) => Promise<T>) => fn({ collection }) };
  }
}
