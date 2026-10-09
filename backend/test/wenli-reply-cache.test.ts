import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWenliReplyCache,
  wenliContextFingerprint,
  wenliReplyCacheKey
} from "../src/services/wenli-reply-cache.js";

const directories: string[] = [];
async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "wenli-cache-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function key(overrides: Partial<Parameters<typeof wenliReplyCacheKey>[0]> = {}): string {
  return wenliReplyCacheKey({
    jobId: "1002_job-1",
    sourceMessageId: "1002_job-1",
    contextFingerprint: wenliContextFingerprint("synthetic context"),
    model: "anthropic/claude-opus-4.6",
    ...overrides
  });
}

describe("Wenli reply cache", () => {
  it("returns a stored reply and counts the hit", async () => {
    const cache = createWenliReplyCache({ directory: await tempDirectory() });
    expect(await cache.get(key())).toBeNull();
    await cache.set(key(), '{"reply":"我在呀 ^ ^","memoryUpdate":null}');
    expect(await cache.get(key())).toBe('{"reply":"我在呀 ^ ^","memoryUpdate":null}');
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, writes: 1, errors: 0 });
  });

  it("keeps different jobs, contexts and models apart", async () => {
    const cache = createWenliReplyCache({ directory: await tempDirectory() });
    await cache.set(key(), "first");
    expect(await cache.get(key({ jobId: "1002_job-2" }))).toBeNull();
    expect(await cache.get(key({ contextFingerprint: wenliContextFingerprint("other context") }))).toBeNull();
    expect(await cache.get(key({ model: "deepseek/deepseek-chat" }))).toBeNull();
    expect(await cache.get(key())).toBe("first");
  });

  it("survives a process restart by reading the disk layer", async () => {
    const directory = await tempDirectory();
    const first = createWenliReplyCache({ directory });
    await first.set(key(), "durable reply");
    // 新实例 = 新的空 L1，只能靠 L2 命中
    const second = createWenliReplyCache({ directory });
    expect(await second.get(key())).toBe("durable reply");
    expect(second.stats().hits).toBe(1);
  });

  it("expires entries after the configured TTL", async () => {
    let clock = 1_000;
    const cache = createWenliReplyCache({ directory: await tempDirectory(), ttlMs: 5_000, now: () => clock });
    await cache.set(key(), "reply");
    clock += 4_999;
    expect(await cache.get(key())).toBe("reply");
    clock += 2;
    expect(await cache.get(key())).toBeNull();
  });

  it("runs the loader only once for concurrent identical requests", async () => {
    const cache = createWenliReplyCache({ directory: await tempDirectory() });
    let calls = 0;
    const loader = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return "generated"; };
    const results = await Promise.all([cache.once(key(), loader), cache.once(key(), loader), cache.once(key(), loader)]);
    expect(calls).toBe(1);
    expect(results).toEqual(["generated", "generated", "generated"]);
  });

  it("caches a negative result briefly instead of retrying the same bad input", async () => {
    let clock = 1_000;
    const cache = createWenliReplyCache({
      directory: await tempDirectory(),
      ttlMs: 60_000,
      negativeTtlMs: 5_000,
      now: () => clock
    });
    let calls = 0;
    const loader = async () => { calls += 1; return null; };
    expect(await cache.once(key(), loader)).toBeNull();
    expect(await cache.once(key(), loader)).toBeNull();
    expect(calls).toBe(1);
    clock += 6_000;
    await cache.once(key(), loader);
    expect(calls).toBe(2);
  });

  it("does not persist a failure as a reply", async () => {
    const cache = createWenliReplyCache({ directory: await tempDirectory() });
    await expect(cache.once(key(), async () => { throw new Error("model down"); })).rejects.toThrow("model down");
    expect(await cache.get(key())).toBeNull();
    expect(cache.stats().inFlight).toBe(0);
  });

  it("evicts least recently used memory entries beyond the limit", async () => {
    const cache = createWenliReplyCache({ directory: await tempDirectory(), memoryEntries: 2 });
    for (const job of ["a", "b", "c"]) {
      await cache.set(key({ jobId: `job-${job}` }), `reply-${job}`);
    }
    expect(cache.stats().evictions).toBeGreaterThan(0);
    // 磁盘仍然保留，所以最旧的一条照样能取到（只是不再在 L1）
    expect(await cache.get(key({ jobId: "job-a" }))).toBe("reply-a");
  });

  it("treats a corrupted cache file as a miss instead of failing the reply", async () => {
    const directory = await tempDirectory();
    const cache = createWenliReplyCache({ directory });
    await writeFile(join(directory, `${key()}.json`), "{not json", "utf8");
    expect(await cache.get(key())).toBeNull();
    expect(cache.stats().errors).toBe(0);
  });

  it("never lets cache failures surface as reply failures", async () => {
    const cache = createWenliReplyCache({ directory: join("\u0000invalid", "cache") });
    await expect(cache.set(key(), "reply")).resolves.toBeUndefined();
    expect(cache.stats().errors).toBeGreaterThan(0);
  });

  it("ignores oversized or empty payloads", async () => {
    const cache = createWenliReplyCache({ directory: await tempDirectory() });
    await cache.set(key(), "");
    expect(await cache.get(key())).toBeNull();
    await cache.set(key(), "x".repeat(200_001));
    expect(await cache.get(key())).toBeNull();
  });

  it("writes atomically and leaves no temporary files behind", async () => {
    const directory = await tempDirectory();
    const cache = createWenliReplyCache({ directory });
    await cache.set(key(), "reply");
    const names = await readdir(directory);
    expect(names.filter((name) => name.endsWith(".tmp"))).toHaveLength(0);
    expect(names.filter((name) => name.endsWith(".json"))).toHaveLength(1);
  });

  it("reports a hit rate for observability", async () => {
    const cache = createWenliReplyCache({ directory: await tempDirectory() });
    await cache.set(key(), "reply");
    await cache.get(key());
    await cache.get(key({ jobId: "miss" }));
    expect(cache.stats().hitRate).toBeCloseTo(0.5, 5);
  });

  it("derives a stable key for identical inputs", () => {
    expect(key()).toBe(key());
    expect(key()).toHaveLength(64);
    expect(vi.isMockFunction(vi.fn())).toBe(true);
  });

  it("invalidates cached replies when the prompt or generation strategy changes", async () => {
    // GPT-5.6 Sol 复核建议：缓存键要带生成策略指纹，否则改了人格提示词之后，
    // 旧任务重试会命中"旧提示词产出的回复"。
    const cache = createWenliReplyCache({ directory: await tempDirectory() });
    const before = key({ generationFingerprint: "fingerprint-v1" });
    const after = key({ generationFingerprint: "fingerprint-v2" });
    expect(before).not.toBe(after);

    let calls = 0;
    const generate = async () => { calls += 1; return `第 ${calls} 版提示词的回复`; };
    expect(await cache.once(before, generate)).toBe("第 1 版提示词的回复");
    // 换了提示词，同一条消息必须重新生成
    expect(await cache.once(after, generate)).toBe("第 2 版提示词的回复");
    expect(calls).toBe(2);
    // 同一版提示词仍可复用
    expect(await cache.once(after, generate)).toBe("第 2 版提示词的回复");
    expect(calls).toBe(2);
  });

  it("gives every new message a fresh reply instead of replaying the first one", async () => {
    // 语义守卫（GPT-6 复核）：应用层缓存只能复用"同一条消息的同一份工作"，
    // 绝不能因为两句输入文字相同就把第一次的回复原样吐出来。
    // 现实中每条 @问理 都有独立的来源消息 id 与时间，因此键天然不同。
    const cache = createWenliReplyCache({ directory: await tempDirectory() });
    const first = key({ jobId: "1002_msg-a", sourceMessageId: "1002_msg-a", contextFingerprint: wenliContextFingerprint("你好") });
    const second = key({ jobId: "1002_msg-b", sourceMessageId: "1002_msg-b", contextFingerprint: wenliContextFingerprint("你好") });
    expect(first).not.toBe(second);

    let calls = 0;
    const generate = async () => { calls += 1; return `第 ${calls} 次现场生成的回复`; };
    const a = await cache.once(first, generate);
    const b = await cache.once(second, generate);
    expect(a).toBe("第 1 次现场生成的回复");
    expect(b).toBe("第 2 次现场生成的回复");
    expect(calls).toBe(2);

    // 而同一条消息的重复处理（租约到期重试）才复用，避免重复计费
    expect(await cache.once(first, generate)).toBe("第 1 次现场生成的回复");
    expect(calls).toBe(2);
  });
});
