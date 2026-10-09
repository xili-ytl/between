import { describe, expect, it, vi } from "vitest";
import { MemoryMomentStore } from "../src/adapters/memory-stores.js";
import { StoreWenliMomentContextProvider, resolveWenliMomentQuery } from "../src/services/wenli-moment-context.js";
import type { MessageRecord } from "../src/domain/contracts.js";

const signal = new AbortController().signal;
const post = (id: string, body: string, authorId: "1001" | "1002" = "1001") => ({
  id: `${authorId}_${id}`, authorId, clientMomentId: id, body, visibility: "PARTNER" as const,
  createdAt: `2026-08-${id === "old" ? "01" : "30"}T12:00:00.000Z`, deleting: false
});

describe("read-only shared Moments retrieval", () => {
  it("stops carrying private post context after a topic change or a stale conversation", () => {
    const message = (body: string, createdAt: string): MessageRecord => ({ id: "1002_synthetic", clientMessageId: "synthetic", senderId: "1002", recipientId: "1001", relationshipId: "couple", body, createdAt });
    const current = message("@问理 那张图是什么颜色", "2026-09-30T04:00:00.000Z");
    const topic = message("@问理 朋友圈银杏叶照片", "2026-09-30T03:59:00.000Z");
    expect(resolveWenliMomentQuery(current, [topic], null)).toContain("朋友圈银杏叶");
    expect(resolveWenliMomentQuery(current, [topic, message("@问理 教我矩阵快速幂", "2026-09-30T03:59:30.000Z")], null)).toBe(current.body);
    expect(resolveWenliMomentQuery(current, [{ ...topic, createdAt: "2026-09-29T03:59:00.000Z" }], null)).toBe(current.body);
    expect(resolveWenliMomentQuery(message("@问理 她为什么这么说", current.createdAt), [topic, message("我们刚讨论过一个新闻事件", "2026-09-30T03:59:30.000Z")], null)).not.toContain("朋友圈");
  });

  it("loads bounded comments only when requested, with their original author and post attribution", async () => {
    const store = new MemoryMomentStore();
    await store.appendMomentIfAbsent(post("shared", "河边的银杏叶", "1002"));
    await store.appendCommentToVisibleMomentIfAbsent({ id: "1001_leaf", authorId: "1001", clientCommentId: "leaf", momentId: "1002_shared", body: "书签是我带来的", createdAt: "2026-08-30T13:00:00.000Z" });
    const readComments = vi.spyOn(store, "commentsFor");
    const provider = new StoreWenliMomentContextProvider(store);
    await provider.select("朋友圈河边银杏叶", signal);
    expect(readComments).not.toHaveBeenCalled();
    const result = await provider.select("朋友圈河边银杏叶下，示例乙评论了什么？", signal);
    expect(readComments).toHaveBeenCalledExactlyOnceWith(["1002_shared"]);
    expect(result).toMatchObject({ commentsStatus: "found", comments: [{ authorId: "1001", momentId: "1002_shared", body: "书签是我带来的" }] });
  });

  it("does not lose post evidence when comment retrieval fails", async () => {
    const readComments = vi.fn(async () => { throw new Error("unavailable"); });
    const provider = new StoreWenliMomentContextProvider({ latestVisibleMoments: async () => [post("shared", "银杏叶")], commentsForContext: readComments });
    const result = await provider.select("朋友圈银杏叶有什么评论", signal);
    expect(result).toMatchObject({ status: "found", commentsStatus: "unavailable", comments: [] });
    expect(result.posts).toHaveLength(1);
  });

  it.each(["@问理 教我动态规划", "HTTP POST 请求是什么", "JavaScript moment 库怎么用", "最近 AI 行业动态"])("does not treat unrelated topics as private Moments: %s", async query => {
    const read = vi.fn(async () => []);
    const result = await new StoreWenliMomentContextProvider({ latestVisibleMoments: read }).select(query, signal);
    expect(result.status).toBe("not_requested");
    expect(read).not.toHaveBeenCalled();
  });
  it("finds a relevant older post ahead of newer unrelated posts without scanning on greetings", async () => {
    const store = new MemoryMomentStore();
    await store.appendMomentIfAbsent(post("old", "河边银杏叶和红色书签", "1002"));
    for (let i = 0; i < 60; i++) await store.appendMomentIfAbsent({ ...post(`new${i}`, "今天喝水散步"), createdAt: `2026-08-30T12:${String(i).padStart(2, "0")}:00.000Z` });
    const spy = vi.spyOn(store, "latestVisibleMoments");
    const provider = new StoreWenliMomentContextProvider(store);
    expect((await provider.select("@问理 你好呀", signal)).status).toBe("not_requested");
    expect(spy).not.toHaveBeenCalled();
    const result = await provider.select("@问理 朋友圈里那片银杏叶在哪条？", signal);
    expect(result.posts[0]?.id).toBe("1002_old");
    expect(result.scanned).toBe(61);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("does not revive a deleted post or leak an old SELF post", async () => {
    const store = new MemoryMomentStore();
    await store.appendMomentIfAbsent(post("shared", "今晚看星星", "1001"));
    await store.appendMomentIfAbsent({ ...post("hidden", "秘密日记", "1002"), visibility: "SELF" });
    const provider = new StoreWenliMomentContextProvider(store);
    expect((await provider.select("朋友圈今晚看星星", signal)).posts.map(item => item.id)).toEqual(["1001_shared"]);
    await store.markDeleting("1001_shared");
    expect((await provider.select("朋友圈今晚看星星", signal)).posts).toEqual([]);
  });

  it("distinguishes empty and unavailable reads and aborts without inventing records", async () => {
    const empty = new StoreWenliMomentContextProvider(new MemoryMomentStore());
    expect((await empty.select("朋友圈有什么", signal)).status).toBe("empty");
    const broken = new StoreWenliMomentContextProvider({ latestVisibleMoments: async () => { throw new Error("cloud unavailable"); } });
    expect((await broken.select("朋友圈有什么", signal)).status).toBe("unavailable");
    const controller = new AbortController(); controller.abort();
    await expect(broken.select("朋友圈有什么", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
