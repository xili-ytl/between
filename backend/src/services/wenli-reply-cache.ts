/**
 * 问理回复缓存（本地 runner 用）—— 按成熟缓存做法实现。
 *
 * 分五层，各自解决一个真实浪费：
 * 1. L1 进程内 LRU + TTL：同一进程重复处理同一任务不再读盘。
 * 2. L2 磁盘内容寻址：进程重启、租约到期重试后仍然命中（键 = sha256(任务+来源+上下文指纹+模型)）。
 * 3. single-flight：同键并发只跑一次模型，其余等待复用结果（避免重复计费）。
 * 4. 负缓存：空结果/明确失败以更短 TTL 记住，避免对同一个坏输入反复重试烧钱。
 * 5. 可观测：命中/未命中/写入/淘汰/错误 计数，供 runner 打印命中率。
 *
 * 语义边界（不能为了省钱做错事）：
 * - 只缓存「模型返回且解析通过」的成功结果由调用方负责；本模块不判断内容正确性。
 * - 键包含上下文指纹，上下文变了必然未命中，不会拿旧回复回答新对话。
 * - 任何缓存读写错误都降级为「没有缓存」，绝不把缓存故障变成回复故障。
 * - 磁盘条目为原子写（临时文件 + rename），进程被杀不会留下半个文件被当成命中。
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface WenliReplyCacheOptions {
  /** 缓存目录；默认放系统临时目录，避免污染仓库。 */
  directory?: string;
  /** 成功结果 TTL。 */
  ttlMs?: number;
  /** 负缓存 TTL（空结果/失败），默认远短于成功 TTL。 */
  negativeTtlMs?: number;
  /** 进程内 L1 容量。 */
  memoryEntries?: number;
  /** 磁盘条目上限，超出按 LRU（mtime 最旧）淘汰。 */
  diskEntries?: number;
  now?: () => number;
}

export interface WenliReplyCacheStats {
  hits: number;
  misses: number;
  writes: number;
  evictions: number;
  errors: number;
  inFlight: number;
  /** 命中的请求数占总请求数的比例，用于 runner 汇报。 */
  hitRate: number;
}

export interface WenliReplyCache {
  /** 读取；未命中返回 null。 */
  get(key: string): Promise<string | null>;
  /** 写入成功结果。 */
  set(key: string, raw: string): Promise<void>;
  /** 写入负缓存（空结果/失败），TTL 更短。 */
  setNegative(key: string): Promise<void>;
  /**
   * single-flight：同键并发只执行一次 loader，其余等待并复用同一结果。
   * loader 抛错或返回 null 时不缓存，避免把失败固化成"已回复"。
   */
  once(key: string, loader: () => Promise<string | null>): Promise<string | null>;
  stats(): WenliReplyCacheStats;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_NEGATIVE_TTL_MS = 60 * 1000;
const DEFAULT_MEMORY_ENTRIES = 64;
const DEFAULT_DISK_ENTRIES = 200;
const MAX_PAYLOAD_CHARS = 200_000;

interface MemoryEntry {
  raw: string | null;
  expiresAt: number;
}

/** 三态查询结果：命中 / 已缓存的负结果 / 不存在。负缓存必须与"不存在"区分，否则去重失效。 */
type LookupResult = { state: "hit"; raw: string } | { state: "negative" } | { state: "absent" };

/** 内容寻址键：来源 + 上下文指纹 + 模型 + 生成策略指纹，任一变化都不命中。 */
export function wenliReplyCacheKey(parts: {
  jobId: string;
  sourceMessageId: string;
  contextFingerprint: string;
  model: string;
  /** 生成策略指纹（提示词/输出合同/搜索策略）。旧数据缺失时按空串处理，不影响读取。 */
  generationFingerprint?: string;
}): string {
  return createHash("sha256")
    .update(
      [parts.jobId, parts.sourceMessageId, parts.contextFingerprint, parts.model, parts.generationFingerprint ?? ""].join("\u0000"),
      "utf8"
    )
    .digest("hex");
}

/** 上下文指纹只用于判定「是不是同一段上下文」，不保存原文。 */
export function wenliContextFingerprint(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32);
}

export function createWenliReplyCache(options: WenliReplyCacheOptions = {}): WenliReplyCache {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
  const memoryLimit = Math.max(1, options.memoryEntries ?? DEFAULT_MEMORY_ENTRIES);
  const diskLimit = Math.max(1, options.diskEntries ?? DEFAULT_DISK_ENTRIES);
  const now = options.now ?? (() => Date.now());
  const directory = options.directory ?? join(process.env.TEMP ?? process.env.TMP ?? ".", "wenli-reply-cache");

  const memory = new Map<string, MemoryEntry>();
  const inFlight = new Map<string, Promise<string | null>>();
  const counters = { hits: 0, misses: 0, writes: 0, evictions: 0, errors: 0 };
  let diskSweepAt = 0;

  const fileFor = (key: string): string => join(directory, `${key}.json`);

  function rememberInMemory(key: string, raw: string | null, expiresAt: number): void {
    memory.delete(key);
    memory.set(key, { raw, expiresAt });
    while (memory.size > memoryLimit) {
      const oldest = memory.keys().next();
      if (oldest.done) break;
      memory.delete(oldest.value);
      counters.evictions += 1;
    }
  }

  async function readDisk(key: string): Promise<{ raw: string | null; negative: boolean } | null> {
    const parsed = JSON.parse(await readFile(fileFor(key), "utf8")) as {
      expiresAt?: unknown;
      raw?: unknown;
      negative?: unknown;
    };
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt <= now()) return null;
    const negative = parsed.negative === true || typeof parsed.raw !== "string";
    const raw = negative ? null : (parsed.raw as string);
    rememberInMemory(key, raw, parsed.expiresAt);
    return { raw, negative };
  }

  async function writeDisk(key: string, raw: string | null, expiresAt: number): Promise<void> {
    await mkdir(directory, { recursive: true });
    const target = fileFor(key);
    const temporary = `${target}.${process.pid}.${now()}.tmp`;
    const payload = JSON.stringify(raw === null ? { expiresAt, negative: true } : { expiresAt, raw });
    await writeFile(temporary, payload, "utf8");
    await rename(temporary, target);
    // 临时文件残留清理：rename 成功后不存在；失败路径交给下面 catch 统一处理。
    await rm(temporary, { force: true }).catch(() => undefined);
  }

  /** LRU 淘汰：超过上限时按最旧访问时间删除。节流，避免每次写都扫盘。 */
  async function pruneDisk(): Promise<void> {
    if (now() - diskSweepAt < 10_000) return;
    diskSweepAt = now();
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    if (names.length <= diskLimit) return;
    const described = await Promise.all(names.map(async (name) => {
      const info = await stat(join(directory, name)).catch(() => null);
      return { name, mtime: info?.mtimeMs ?? 0 };
    }));
    described.sort((left, right) => left.mtime - right.mtime);
    const excess = described.slice(0, described.length - diskLimit);
    for (const entry of excess) {
      await rm(join(directory, entry.name), { force: true }).catch(() => undefined);
      counters.evictions += 1;
    }
  }

  async function lookup(key: string): Promise<LookupResult> {
    const cached = memory.get(key);
    if (cached) {
      if (cached.expiresAt > now()) {
        memory.delete(key);
        memory.set(key, cached); // LRU 触碰
        counters.hits += 1;
        return cached.raw === null ? { state: "negative" } : { state: "hit", raw: cached.raw };
      }
      memory.delete(key);
    }
    try {
      const disk = await readDisk(key);
      if (disk === null) {
        counters.misses += 1;
        return { state: "absent" };
      }
      counters.hits += 1;
      return disk.negative ? { state: "negative" } : { state: "hit", raw: disk.raw ?? "" };
    } catch {
      counters.misses += 1;
      return { state: "absent" };
    }
  }

  return {
    async get(key) {
      const result = await lookup(key);
      return result.state === "hit" ? result.raw : null;
    },

    async set(key, raw) {
      if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_PAYLOAD_CHARS) return;
      const expiresAt = now() + ttlMs;
      rememberInMemory(key, raw, expiresAt);
      try {
        await writeDisk(key, raw, expiresAt);
        counters.writes += 1;
        await pruneDisk().catch(() => undefined);
      } catch {
        counters.errors += 1;
      }
    },

    async setNegative(key) {
      const expiresAt = now() + negativeTtlMs;
      rememberInMemory(key, null, expiresAt);
      try {
        await writeDisk(key, null, expiresAt);
        counters.writes += 1;
      } catch {
        counters.errors += 1;
      }
    },

    async once(key, loader) {
      const cached = await lookup(key);
      if (cached.state === "hit") return cached.raw;
      if (cached.state === "negative") return null;
      const existing = inFlight.get(key);
      if (existing) return existing;
      const running = (async () => {
        try {
          const produced = await loader();
          if (produced === null) {
            await this.setNegative(key).catch(() => undefined);
            return null;
          }
          await this.set(key, produced).catch(() => undefined);
          return produced;
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, running);
      return running;
    },

    stats() {
      const total = counters.hits + counters.misses;
      return {
        ...counters,
        inFlight: inFlight.size,
        hitRate: total === 0 ? 0 : Number((counters.hits / total).toFixed(4))
      };
    }
  };
}
