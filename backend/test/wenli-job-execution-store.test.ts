import { createHash } from "node:crypto";
import type { CloudBase } from "@cloudbase/node-sdk";
import { describe, expect, it, vi } from "vitest";
import { MemoryMessageStore } from "../src/adapters/memory-stores.js";
import { MemoryWenliJobExecutionStore, CloudBaseWenliJobExecutionStore } from "../src/adapters/wenli-job-execution-stores.js";
import type { DocumentData } from "../src/adapters/cloudbase-stores.js";
import type { AccountId, MessageRecord } from "../src/domain/contracts.js";
import type { WenliAgentJob } from "../src/domain/wenli-agent.js";
import type { WenliJobExecutionStore } from "../src/ports/wenli-job-execution-store.js";

const T0 = "2026-08-31T00:00:00.000Z";
const T1 = "2026-08-31T00:01:00.000Z";
const T2 = "2026-08-31T00:02:00.000Z";

describe("Wenli job execution stores", () => {
  executionStoreContract("MemoryWenliJobExecutionStore", () => {
    const messages = new MemoryMessageStore();
    const store = new MemoryWenliJobExecutionStore(messages);
    return { store, seedMessage: async (message) => { await messages.appendIfAbsent(message); } };
  });
  executionStoreContract("CloudBaseWenliJobExecutionStore", () => {
    const cloud = new FakeCloudBase();
    return {
      store: new CloudBaseWenliJobExecutionStore(cloud as unknown as CloudBase),
      seedMessage: (message) => cloud.putRaw("messages", message.id, { ...message })
    };
  });

  it("accepts CloudBase object, array, and null document get payloads", async () => {
    const cloud = new FakeCloudBase();
    const store = new CloudBaseWenliJobExecutionStore(cloud as unknown as CloudBase);
    const source = mention("1001_array");
    const job = pendingJob(source);
    await cloud.putRaw("messages", source.id, { ...source });
    await cloud.putRaw("wenliAgentJobs", job.id, { ...job });
    cloud.getMode = "array";

    await expect(store.source(source.id)).resolves.toEqual(source);
    await expect(store.get(job.id)).resolves.toEqual(job);

    cloud.getMode = "object";
    await expect(store.source(source.id)).resolves.toEqual(source);
    await expect(store.source("missing")).resolves.toBeNull();
  });

  it("rolls back CloudBase transaction writes when a later resolved SDK error is returned", async () => {
    const cloud = new FakeCloudBase();
    const store = new CloudBaseWenliJobExecutionStore(cloud as unknown as CloudBase);
    const source = mention("1001_rollback");
    const job = pendingJob(source);
    await cloud.putRaw("messages", source.id, { ...source });
    await cloud.putRaw("wenliAgentJobs", job.id, { ...job });
    const claimed = await store.claim(job.id, claim("token-a"));
    expect(claimed).not.toBeNull();
    cloud.failNextSet = { code: "INTERNAL" };

    await expect(store.complete(job.id, "token-a", T0, "不能写入")).rejects.toMatchObject({ code: "INTERNAL" });

    expect(await cloud.getRaw("messages", replyIdFor(source.id))).toBeNull();
    const afterRollback = await store.get(job.id);
    expect(afterRollback).toMatchObject({ status: "running" });
    expect(afterRollback).not.toHaveProperty("responseMessageId");
  });

  it("fails closed when a CloudBase deterministic reply document is malformed", async () => {
    const cloud = new FakeCloudBase();
    const store = new CloudBaseWenliJobExecutionStore(cloud as unknown as CloudBase);
    const source = mention("1001_malformed_reply");
    const job = pendingJob(source);
    await cloud.putRaw("messages", source.id, { ...source });
    await cloud.putRaw("wenliAgentJobs", job.id, { ...job });
    await cloud.putRaw("messages", replyIdFor(source.id), {
      id: replyIdFor(source.id),
      relationshipId: "couple",
      senderId: "wenli",
      recipientId: "1002",
      clientMessageId: replyIdFor(source.id).slice("wenli_".length),
      createdAt: T0
    });

    await expect(store.claim(source.id, claim("token-a"))).resolves.toBeNull();

    await expect(store.get(source.id)).resolves.toMatchObject({
      status: "dead",
      lastErrorCode: "WENLI_REPLY_INVALID",
      attemptCount: 0
    });
  });

  it("uses the shared narrow SDK due-query path for CloudBase execution jobs", async () => {
    const source = mention("1001_due_shared");
    const job = pendingJob(source);
    const due = executionDueDatabase([
      { data: [{ _id: job.id, ...job }] },
      { data: [] },
      { data: [] }
    ]);
    const store = new CloudBaseWenliJobExecutionStore({ database: () => due.database } as unknown as CloudBase);

    await expect(store.listDue(T0, 1)).resolves.toEqual([job]);

    expect(due.collection).toHaveBeenCalledTimes(3);
    expect(due.queries.map(({ where }) => where.mock.calls[0]![0])).toEqual([
      { status: "pending", nextAttemptAt: { lte: T0 } },
      { status: "retry", nextAttemptAt: { lte: T0 } },
      { status: "running", leaseUntil: { lte: T0 } }
    ]);
    expect(due.scanDocuments).not.toHaveBeenCalled();
  });
});

function executionStoreContract(
  name: string,
  create: () => { store: WenliJobExecutionStore; seedMessage: (message: MessageRecord) => Promise<void> | void }
): void {
  describe(name, () => {
    it("claims only one concurrent worker and increments the attempt once", async () => {
      const { store, seedMessage } = create();
      const source = mention("1001_claim");
      await seed(store, seedMessage, source, pendingJob(source));

      const [first, second] = await Promise.all([
        store.claim(source.id, claim("token-a")),
        store.claim(source.id, claim("token-b"))
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
      await expect(store.get(source.id)).resolves.toMatchObject({
        status: "running",
        attemptCount: 1,
        leaseToken: expect.any(String),
        leaseUntil: "2026-08-31T00:01:30.000Z"
      });
    });

    it("does not claim future retry jobs and allows takeover exactly at lease expiry", async () => {
      const { store, seedMessage } = create();
      const source = mention("1001_retry");
      await seed(store, seedMessage, source, {
        ...pendingJob(source),
        status: "retry",
        attemptCount: 1,
        nextAttemptAt: T1
      });

      await expect(store.claim(source.id, claim("token-a", { now: T0 }))).resolves.toBeNull();
      await expect(store.claim(source.id, claim("token-a", { now: T1 }))).resolves.toMatchObject({
        status: "running",
        attemptCount: 2,
        leaseToken: "token-a"
      });
      await expect(store.claim(source.id, claim("token-b", { now: "2026-08-31T00:02:30.000Z" }))).resolves.toMatchObject({
        attemptCount: 3,
        leaseToken: "token-b"
      });
    });

    it("rejects terminal jobs, warmups, and exhausted attempts without generating", async () => {
      const { store, seedMessage } = create();
      const source = mention("1001_terminal");
      await seed(store, seedMessage, source, { ...pendingJob(source), status: "succeeded", responseMessageId: "wenli_reply_x" });
      await expect(store.claim(source.id, claim("token-a"))).resolves.toBeNull();

      const { sourceMessageId: _sourceMessageId, ...warmupBase } = pendingJob(mention("1001_warmup"));
      void _sourceMessageId;
      const warmup = { ...warmupBase, id: "warmup", type: "warmup" as const };
      await seed(store, seedMessage, source, warmup);
      await expect(store.claim(warmup.id, claim("token-b"))).resolves.toBeNull();

      const exhausted = { ...pendingJob(mention("1001_exhausted")), attemptCount: 3 };
      await seed(store, seedMessage, mention("1001_exhausted"), exhausted);
      await expect(store.claim(exhausted.id, claim("token-c"))).resolves.toBeNull();
      await expect(store.get(exhausted.id)).resolves.toMatchObject({ status: "dead", attemptCount: 3 });
    });

    it("repairs a valid existing deterministic reply before checking exhausted attempts", async () => {
      const { store, seedMessage } = create();
      const source = mention("1001_repair");
      const reply = replyFor(source, "原回复", "2026-08-30T23:59:00.000Z");
      await seed(store, seedMessage, source, { ...pendingJob(source), status: "dead", attemptCount: 99 });
      await seedMessage(reply);

      await expect(store.claim(source.id, claim("token-a"))).resolves.toBeNull();

      await expect(store.get(source.id)).resolves.toMatchObject({
        status: "succeeded",
        attemptCount: 99,
        responseMessageId: reply.id
      });
      await expect(store.source(reply.id)).resolves.toEqual(reply);
    });

    it("fails closed when the deterministic reply id belongs to conflicting content", async () => {
      const { store, seedMessage } = create();
      const source = mention("1001_conflict");
      await seed(store, seedMessage, source, pendingJob(source));
      await seedMessage({ ...replyFor(source, "冲突"), sourceMessageId: "1002_other", replyToMessageId: "1002_other" });

      await expect(store.claim(source.id, claim("token-a"))).resolves.toBeNull();

      await expect(store.get(source.id)).resolves.toMatchObject({
        status: "dead",
        lastErrorCode: "WENLI_REPLY_INVALID",
        attemptCount: 0
      });
    });

    it("requires a live exact lease token for complete and fail", async () => {
      const { store, seedMessage } = create();
      const source = mention("1001_fence");
      await seed(store, seedMessage, source, pendingJob(source));
      await expect(store.claim(source.id, claim("old-token"))).resolves.not.toBeNull();

      await expect(store.complete(source.id, "wrong-token", T0, "不会写入")).resolves.toBeNull();
      await expect(store.complete(source.id, "old-token", "2026-08-31T00:01:30.000Z", "过期不能写")).resolves.toBeNull();
      await expect(store.fail(source.id, "old-token", "2026-08-31T00:01:30.000Z", failure())).resolves.toBe(false);
      await expect(store.claim(source.id, claim("new-token", { now: "2026-08-31T00:01:30.000Z" }))).resolves.not.toBeNull();
      await expect(store.fail(source.id, "old-token", T2, failure())).resolves.toBe(false);
      await expect(store.complete(source.id, "old-token", T2, "旧工人不能写")).resolves.toBeNull();

      expect(await store.source(replyIdFor(source.id))).toBeNull();
    });

    it("atomically appends a bounded reply and marks the job succeeded", async () => {
      const { store, seedMessage } = create();
      const source = mention("1002_complete", { senderId: "1002", recipientId: "1001" });
      await seed(store, seedMessage, source, pendingJob(source));
      await store.claim(source.id, claim("token-a"));

      const reply = await store.complete(source.id, "token-a", T0, "  好的  ");

      expect(reply).toEqual(replyFor(source, "好的", T0));
      const completed = await store.get(source.id);
      expect(completed).toMatchObject({
        status: "succeeded",
        responseMessageId: reply?.id
      });
      expect(completed).not.toHaveProperty("leaseToken");
      expect(completed).not.toHaveProperty("leaseUntil");
      expect(completed).not.toHaveProperty("nextAttemptAt");
      expect(completed).not.toHaveProperty("lastErrorCode");
      await expect(store.complete(source.id, "token-a", T0, "重复")).resolves.toBeNull();
    });

    it("rejects invalid sources and bad reply bodies without publishing", async () => {
      const { store, seedMessage } = create();
      for (const source of [
        mention("1001_plain", { body: "普通消息" }),
        mention("1001_image", { type: "image" }),
        mention("1001_mismatch", { senderId: "1001", recipientId: "1001" })
      ]) {
        await seed(store, seedMessage, source, pendingJob(source));
        await store.claim(source.id, claim(`token-${source.id}`));
        await expect(store.complete(source.id, `token-${source.id}`, T0, "回复")).resolves.toBeNull();
        await expect(store.get(source.id)).resolves.toMatchObject({ status: "dead", lastErrorCode: "WENLI_SOURCE_INVALID" });
      }

      const valid = mention("1001_bad_reply");
      await seed(store, seedMessage, valid, pendingJob(valid));
      await store.claim(valid.id, claim("token-bad"));
      await expect(store.complete(valid.id, "token-bad", T0, "")).resolves.toBeNull();
      await expect(store.get(valid.id)).resolves.toMatchObject({ status: "dead", lastErrorCode: "WENLI_REPLY_INVALID" });
      expect(await store.source(replyIdFor(valid.id))).toBeNull();
    });

    it("records retry delays, final failure, and only generic failure codes", async () => {
      const { store, seedMessage } = create();
      const source = mention("1001_fail");
      await seed(store, seedMessage, source, pendingJob(source));
      await store.claim(source.id, claim("token-a"));

      await expect(store.fail(source.id, "token-a", T0, failure())).resolves.toBe(true);
      await expect(store.get(source.id)).resolves.toMatchObject({
        status: "retry",
        nextAttemptAt: "2026-08-31T00:00:30.000Z",
        lastErrorCode: "WENLI_GENERATION_FAILED"
      });

      await expect(store.claim(source.id, claim("token-b", { now: "2026-08-31T00:00:30.000Z" }))).resolves.not.toBeNull();
      await expect(store.fail(source.id, "token-b", "2026-08-31T00:00:30.000Z", failure({ code: "WENLI_GENERATION_TIMEOUT" }))).resolves.toBe(true);
      await expect(store.get(source.id)).resolves.toMatchObject({
        status: "retry",
        nextAttemptAt: "2026-08-31T00:01:30.000Z",
        lastErrorCode: "WENLI_GENERATION_TIMEOUT"
      });

      await expect(store.claim(source.id, claim("token-c", { now: "2026-08-31T00:01:30.000Z" }))).resolves.not.toBeNull();
      await expect(store.fail(source.id, "token-c", "2026-08-31T00:01:30.000Z", failure())).resolves.toBe(true);
      await expect(store.get(source.id)).resolves.toMatchObject({ status: "dead" });

      await expect(store.fail(source.id, "token-c", T2, failure({ code: "RAW_PROVIDER_500" as "WENLI_GENERATION_FAILED" })))
        .rejects.toThrow("invalid Wenli failure");
    });

    it("validates arguments and returns defensive copies", async () => {
      const { store, seedMessage } = create();
      const source = mention("1001_args");
      await seed(store, seedMessage, source, pendingJob(source));

      await expect(store.claim("", claim("token-a"))).rejects.toThrow("invalid Wenli");
      await expect(store.claim(source.id, claim("", { leaseMs: 90_000 }))).rejects.toThrow("invalid Wenli");
      await expect(store.claim(source.id, claim("x".repeat(201)))).rejects.toThrow("invalid Wenli");
      await expect(store.claim(source.id, claim("token-a", { now: "today" }))).rejects.toThrow("invalid Wenli");
      await expect(store.claim(source.id, claim("token-a", { leaseMs: 0 }))).rejects.toThrow("invalid Wenli");
      await expect(store.claim(source.id, claim("token-a", { leaseMs: 2_147_483_648 }))).rejects.toThrow("invalid Wenli");

      const claimed = await store.claim(source.id, claim("token-a"));
      expect(claimed).not.toBeNull();
      claimed!.status = "dead";
      await expect(store.get(source.id)).resolves.toMatchObject({ status: "running" });
      const loadedSource = await store.source(source.id);
      loadedSource!.body = "mutated";
      await expect(store.source(source.id)).resolves.toEqual(source);
    });
  });
}

async function seed(
  store: WenliJobExecutionStore,
  seedMessage: (message: MessageRecord) => Promise<void> | void,
  source: MessageRecord,
  job: WenliAgentJob
): Promise<void> {
  await seedMessage(source);
  await store.createIfAbsent(job);
}

function pendingJob(source: MessageRecord): WenliAgentJob {
  return {
    id: source.id,
    type: "mention",
    requesterId: source.senderId as AccountId,
    sourceMessageId: source.id,
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: T0,
    createdAt: T0,
    updatedAt: T0
  };
}

function mention(id: string, overrides: Partial<MessageRecord> = {}): MessageRecord {
  const senderId = (overrides.senderId ?? id.slice(0, 4)) as AccountId;
  const clientMessageId = id.slice(5);
  return {
    id,
    relationshipId: "couple",
    senderId,
    recipientId: senderId === "1001" ? "1002" : "1001",
    clientMessageId,
    body: "@小Q 在吗",
    createdAt: "2026-08-30T23:59:00.000Z",
    ...overrides
  };
}

function replyFor(source: MessageRecord, body: string, createdAt = T0): MessageRecord {
  const id = replyIdFor(source.id);
  const clientMessageId = id.slice("wenli_".length);
  return {
    id,
    relationshipId: "couple",
    senderId: "wenli",
    recipientId: source.recipientId,
    clientMessageId,
    body,
    replyToMessageId: source.id,
    sourceMessageId: source.id,
    createdAt
  };
}

function replyIdFor(sourceMessageId: string): string {
  return `wenli_reply_${createHash("sha256").update(sourceMessageId, "utf8").digest("hex").slice(0, 32)}`;
}

function claim(token: string, overrides: Partial<{ now: string; leaseMs: number; maxAttempts: number }> = {}) {
  return { now: T0, token, leaseMs: 90_000, maxAttempts: 3, ...overrides };
}

function failure(overrides: Partial<{
  code: "WENLI_GENERATION_FAILED" | "WENLI_GENERATION_TIMEOUT" | "WENLI_SOURCE_INVALID" | "WENLI_REPLY_INVALID";
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  permanent: boolean;
}> = {}) {
  return {
    code: "WENLI_GENERATION_FAILED" as const,
    maxAttempts: 3,
    baseDelayMs: 30_000,
    maxDelayMs: 300_000,
    ...overrides
  };
}

function executionDueDatabase(results: unknown[]) {
  const queries = results.map((result) => {
    const query = { orderBy: vi.fn(), limit: vi.fn(), get: vi.fn().mockResolvedValue(result) };
    query.orderBy.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    return { where: vi.fn().mockReturnValue(query), ...query };
  });
  let index = 0;
  const collection = vi.fn(() => queries[index++]!);
  const lte = vi.fn((value: string) => ({ lte: value }));
  const scanDocuments = vi.fn();
  return { database: { collection, command: { lte }, scanDocuments }, collection, queries, scanDocuments };
}

class FakeCloudBase {
  getMode: "object" | "array" = "object";
  failNextSet: unknown = null;
  private transactionQueue: Promise<void> = Promise.resolve();
  private readonly collections = new Map<string, Map<string, DocumentData>>();

  database() {
    return {
      collection: (name: string) => this.collectionReference(name),
      runTransaction: async <T>(fn: (transaction: { collection: (name: string) => ReturnType<FakeCloudBase["collectionReference"]> }) => Promise<T>) => {
        const previous = this.transactionQueue;
        let release = () => {};
        this.transactionQueue = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const snapshot = structuredClone([...this.collections].map(([name, records]) => [name, [...records]]));
        try {
          return await fn({ collection: (name: string) => this.collectionReference(name) });
        } catch (error) {
          this.collections.clear();
          for (const [name, entries] of snapshot as Array<[string, Array<[string, DocumentData]>]>) {
            this.collections.set(name, new Map(entries));
          }
          throw error;
        } finally {
          release();
        }
      }
    };
  }

  async putRaw(collection: string, id: string, data: DocumentData): Promise<void> {
    this.collection(collection).set(id, structuredClone(data));
  }

  async getRaw(collection: string, id: string): Promise<DocumentData | null> {
    return structuredClone(this.collection(collection).get(id) ?? null);
  }

  private collectionReference(name: string) {
    return {
      doc: (id: string) => ({
        get: async () => {
          const document = this.collection(name).get(id);
          if (!document) return { data: this.getMode === "array" ? [] : null };
          const withId = { _id: id, ...structuredClone(document) };
          return { data: this.getMode === "array" ? [withId] : withId };
        },
        set: async (data: DocumentData) => {
          if (this.failNextSet) {
            const error = this.failNextSet;
            this.failNextSet = null;
            return error;
          }
          this.collection(name).set(id, structuredClone(data));
          return {};
        },
        update: async (fields: DocumentData) => {
          const current = this.collection(name).get(id);
          if (current) this.collection(name).set(id, { ...current, ...structuredClone(fields) });
          return {};
        }
      })
    };
  }

  private collection(name: string): Map<string, DocumentData> {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new Map();
      this.collections.set(name, collection);
    }
    return collection;
  }
}
