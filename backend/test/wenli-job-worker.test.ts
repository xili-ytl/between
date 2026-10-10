import { describe, expect, it, vi } from "vitest";
import { MemoryMessageStore } from "../src/adapters/memory-stores.js";
import { MemoryWenliJobExecutionStore } from "../src/adapters/wenli-job-execution-stores.js";
import { MemoryWenliMemoryStore } from "../src/adapters/wenli-memory-stores.js";
import type { MessageRecord } from "../src/domain/contracts.js";
import type { WenliAgentJob } from "../src/domain/wenli-agent.js";
import { assertValidWenliSource, deterministicWenliReplyId } from "../src/domain/wenli-reply.js";
import type { WenliTimingEvent } from "../src/domain/wenli-timing.js";
import type { WenliReplyGenerator } from "../src/ports/wenli-reply-generator.js";
import { ChatService } from "../src/services/chat-service.js";
import { WenliJobWorker } from "../src/services/wenli-job-worker.js";
import { WenliTriggerService } from "../src/services/wenli-trigger-service.js";

const T0 = "2026-08-31T00:00:00.000Z";

describe("WenliJobWorker", () => {
  it("returns the durable reply even if auxiliary memory storage never settles", async () => {
    vi.useFakeTimers();
    try {
      const {store,messages}=memoryHarness();
      const source=mention("1001_slow_memory");
      await seed(store,messages,source,pendingJob(source));
      const generator: WenliReplyGenerator={generate:async()=>({reply:"收到",memoryUpdate:"合成偏好"})};
      const pending=workerWith(store,generator,{memoryStore:{append:()=>new Promise(()=>{}),listForContext:async()=>[]}}).process(source.id);
      let complete=false;
      void pending.then(()=>{complete=true;});
      await vi.advanceTimersByTimeAsync(2500);
      expect(complete).toBe(true);
      await expect(pending).resolves.toMatchObject({completed:true});
    } finally { vi.useRealTimers(); }
  });
  it("rejects text image fields and noncanonical image metadata at the domain boundary", () => {
    const base = mention("1001_image_source");
    expect(() => assertValidWenliSource("1001", { ...base, imageFileId: "cloud://bucket/chat-images/1001_image_source.jpg" })).toThrow();
    expect(() => assertValidWenliSource("1001", { ...base, type: "image", imageFileId: "cloud://bucket/chat-images/1001_wrong.jpg", imageMimeType: "image/jpeg" })).toThrow();
    expect(() => assertValidWenliSource("1001", { ...base, type: "image", imageFileId: "cloud://bucket/chat-images/1001_image_source.jpg", imageMimeType: "image/jpeg", imageWidth: 1 })).toThrow();
    expect(() => assertValidWenliSource("1001", { ...base, type: "image", imageFileId: "cloud://bucket/chat-images/1001_image_source.jpg", imageMimeType: "image/jpeg", imageWidth: 0, imageHeight: 1 })).toThrow();
    expect(() => assertValidWenliSource("1001", { ...base, type: "image", body: " [该消息新版本可见] ", imageFileId: "cloud://bucket/chat-images/1001_image_source.jpg", imageMimeType: "image/jpeg", imageWidth: 1, imageHeight: 1 })).toThrow();
  });

  it("repairs an existing deterministic reply without calling the generator", async () => {
    const { store, messages } = memoryHarness();
    const source = mention("1001_repaired");
    await seed(store, messages, source, { ...pendingJob(source), status: "dead", attemptCount: 99 });
    await messages.appendIfAbsent(reply(source, "已经好了"));
    const generator = generatorReturning("不应调用");
    const worker = workerWith(store, generator);

    await expect(worker.process(source.id)).resolves.toEqual({ claimed: false, message: null });

    expect(generator.generate).not.toHaveBeenCalled();
    await expect(store.get(source.id)).resolves.toMatchObject({ status: "succeeded", responseMessageId: reply(source, "已经好了").id });
  });

  it("validates the authoritative source before generation and records permanent source failures", async () => {
    const { store, messages } = memoryHarness();
    const generator = generatorReturning("不应调用");
    const worker = workerWith(store, generator);

    for (const source of [
      mention("1001_plain", { body: "普通消息" }),
      mention("1001_image", { type: "image" }),
      mention("1001_mismatch", { recipientId: "1001" }),
      mention("1001_bad-client", { clientMessageId: "bad/client", id: "1001_bad/client" }),
      mention("1001_bad-time", { createdAt: "today" }),
      mention("1001_large", { body: `@小Q ${"问".repeat(2001)}` })
    ]) {
      await seed(store, messages, source, pendingJob(source));
      await expect(worker.process(source.id)).resolves.toEqual({ claimed: true, completed: false, message: null });
      await expect(store.get(source.id)).resolves.toMatchObject({ status: "dead", lastErrorCode: "WENLI_SOURCE_INVALID" });
    }

    expect(generator.generate).not.toHaveBeenCalled();
  });

  it("turns rejected generation into a generic retry without persisting raw exception text", async () => {
    const { store, messages } = memoryHarness();
    const source = mention("1001_rejected");
    await seed(store, messages, source, pendingJob(source));
    const generator: WenliReplyGenerator = {
      generate: vi.fn(async () => {
        throw new Error("provider secret stack trace");
      })
    };
    const worker = workerWith(store, generator);

    await expect(worker.process(source.id)).resolves.toEqual({ claimed: true, completed: false, message: null });

    await expect(store.get(source.id)).resolves.toMatchObject({
      status: "retry",
      attemptCount: 1,
      nextAttemptAt: "2026-08-31T00:00:30.000Z",
      lastErrorCode: "WENLI_GENERATION_FAILED"
    });
    expect(JSON.stringify(await store.get(source.id))).not.toContain("provider secret");
  });

  it("publishes only the structured reply, never its memory update", async () => {
    const { store, messages } = memoryHarness();
    const source = mention("1001_structured");
    await seed(store, messages, source, pendingJob(source));
    const generator: WenliReplyGenerator = { generate: vi.fn(async () => ({ reply: "只发这句", memoryUpdate: "不应写入聊天" })) };

    await expect(workerWith(store, generator).process(source.id)).resolves.toMatchObject({ claimed: true, completed: true, message: expect.any(Object) });
    await expect(store.source(reply(source, "x").id)).resolves.toMatchObject({ body: "只发这句" });
    expect(JSON.stringify(await messages.get(reply(source, "x").id))).not.toContain("不应写入聊天");
  });

  it("records claim, source, generation and persistence as separate safe stages", async () => {
    const { store, messages } = memoryHarness();
    const source = mention("1001_timing");
    await seed(store, messages, source, pendingJob(source));
    const events: WenliTimingEvent[] = [];
    let tick = 0;
    const generator: WenliReplyGenerator = { generate: vi.fn(async () => ({ reply: "收到", memoryUpdate: null })) };

    await expect(workerWith(store, generator, {
      timingSink: { record: (event) => events.push(event) },
      monotonicClock: () => (tick += 7)
    }).process(source.id)).resolves.toMatchObject({ completed: true });

    expect(events.map((event) => event.stage)).toEqual(["claim", "source_load", "generation_total", "persist"]);
    expect(events.every((event) => event.requestId === source.id && event.jobId === source.id)).toBe(true);
    expect(events.every((event) => event.requestCount === 0 && event.durationMs === 7 && event.outcome === "success")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(source.body);
  });

  it("writes a simplified fact memory only after its reply completion fences successfully", async () => {
    const { store, messages } = memoryHarness();
    const source = mention("1001_memory");
    await seed(store, messages, source, pendingJob(source));
    const memories = new MemoryWenliMemoryStore();
    const generator: WenliReplyGenerator = { generate: vi.fn(async () => ({ reply: "收到", memoryUpdate: "周末想一起看电影" })) };
    await expect(workerWith(store, generator, { memoryStore: memories, memoryIdFactory: () => "mem_fixed" }).process(source.id)).resolves.toEqual({ claimed: true, completed: true, message: expect.any(Object) });
    await expect(memories.listForContext(1)).resolves.toEqual([expect.objectContaining({ id: "mem_fixed", summary: "周末想一起看电影", sourceEventIds: [source.id] })]);
  });

  it("only persists structured candidates whose exact quote comes from the current human", async () => {
    const { store, messages } = memoryHarness();
    const source = {...mention("1001_sourced"),body:"@小Q 我喜欢蓝色杯子"};
    await seed(store,messages,source,pendingJob(source));
    const memories = new MemoryWenliMemoryStore();
    const generator: WenliReplyGenerator = {generate:async()=>({reply:"蓝色杯子，很好看呀 ^ ^",memoryUpdate:null,memoryCandidate:{quote:"我喜欢蓝色杯子",subjectId:"1001",topicKey:"preference.cup",kind:"preference",operation:"remember"}})};
    await workerWith(store,generator,{memoryStore:memories}).process(source.id);
    expect(await memories.listForContext(10)).toEqual([expect.objectContaining({summary:"我喜欢蓝色杯子",subjectId:"1001",sourceEventIds:[source.id]})]);
  });

  it("does not turn a completed reply into failure when memory creation or append fails", async () => {
    const { store, messages } = memoryHarness();
    const source = mention("1001_memory_failure");
    await seed(store, messages, source, pendingJob(source));
    const generator: WenliReplyGenerator = { generate: vi.fn(async () => ({ reply: "收到", memoryUpdate: "重要计划" })) };
    const brokenMemory = { append: vi.fn(async () => { throw new Error("memory unavailable"); }), listForContext: vi.fn(async () => []) };
    await expect(workerWith(store, generator, { memoryStore: brokenMemory, memoryIdFactory: () => { throw new Error("id failure"); } }).process(source.id))
      .resolves.toMatchObject({ claimed: true, completed: true, message: expect.any(Object) });
    await expect(store.get(source.id)).resolves.toMatchObject({ status: "succeeded" });
    expect(brokenMemory.append).not.toHaveBeenCalled();
  });

  it("swallows a non-throwing invalid memory ID after the reply is fenced", async () => {
    const { store, messages } = memoryHarness();
    const source = mention("1001_memory_invalid_id");
    await seed(store, messages, source, pendingJob(source));
    const memories = { append: vi.fn(async () => { throw new Error("must not append"); }), listForContext: vi.fn(async () => []) };
    const fail = vi.spyOn(store, "fail");
    const generator: WenliReplyGenerator = { generate: vi.fn(async () => ({ reply: "收到", memoryUpdate: "重要计划" })) };

    await expect(workerWith(store, generator, { memoryStore: memories, memoryIdFactory: () => "invalid-id" }).process(source.id))
      .resolves.toMatchObject({ claimed: true, completed: true, message: expect.any(Object) });
    await expect(store.get(source.id)).resolves.toMatchObject({ status: "succeeded" });
    expect(memories.append).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it("swallows a rejecting memory append after a fenced reply and does not write null memory", async () => {
    const { store, messages } = memoryHarness();
    const source = mention("1001_memory_append");
    await seed(store, messages, source, pendingJob(source));
    const rejectingMemory = { append: vi.fn(async () => { throw new Error("append failure"); }), listForContext: vi.fn(async () => []) };
    const generator: WenliReplyGenerator = { generate: vi.fn(async () => ({ reply: "收到", memoryUpdate: "重要边界" })) };
    await expect(workerWith(store, generator, { memoryStore: rejectingMemory, memoryIdFactory: () => "mem_valid" }).process(source.id))
      .resolves.toMatchObject({ claimed: true, completed: true, message: expect.any(Object) });
    expect(rejectingMemory.append).toHaveBeenCalledOnce();
    await expect(store.get(source.id)).resolves.toMatchObject({ status: "succeeded" });
  });

  it.each([
    ["", "empty"],
    ["问".repeat(4001), "overlong"],
    [null, "non-string"]
  ])("rejects %s generator output without publishing", async (output, _label) => {
    const { store, messages } = memoryHarness();
    const source = mention(`1001_bad_${String(output).length}`);
    await seed(store, messages, source, pendingJob(source));
    const generator: WenliReplyGenerator = { generate: vi.fn(async () => ({ reply: output as string, memoryUpdate: "private" })) };

    await expect(workerWith(store, generator).process(source.id)).resolves.toEqual({ claimed: true, completed: false, message: null });

    await expect(store.get(source.id)).resolves.toMatchObject({ status: "dead", lastErrorCode: "WENLI_REPLY_INVALID" });
    await expect(store.source(reply(source, "x").id)).resolves.toBeNull();
  });

  it("aborts timed-out generation, clears timers, and records a retryable timeout", async () => {
    vi.useFakeTimers();
    try {
      const { store, messages } = memoryHarness();
      const source = mention("1001_timeout");
      await seed(store, messages, source, pendingJob(source));
      let aborted = false;
      const generator: WenliReplyGenerator = {
        generate: vi.fn((_input, signal) => new Promise<{ reply: string; memoryUpdate: null }>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve({ reply: "late but resolved on abort", memoryUpdate: null });
          });
        }))
      };
      const worker = workerWith(store, generator, { generationTimeoutMs: 50, leaseMs: 100 });

      const processing = worker.process(source.id);
      await vi.advanceTimersByTimeAsync(50);
      await expect(processing).resolves.toEqual({ claimed: true, completed: false, message: null });

      expect(aborted).toBe(true);
      await expect(store.get(source.id)).resolves.toMatchObject({
        status: "retry",
        lastErrorCode: "WENLI_GENERATION_TIMEOUT"
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("discards a stale worker result after another token takes over and completes", async () => {
    let now = new Date(T0);
    const { store, messages } = memoryHarness();
    const source = mention("1001_takeover");
    await seed(store, messages, source, pendingJob(source));
    const first = deferred<{ reply: string; memoryUpdate: string }>();
    const memories = new MemoryWenliMemoryStore();
    const firstGenerator: WenliReplyGenerator = { generate: vi.fn(() => first.promise) };
    const firstWorker = workerWith(store, firstGenerator, { clock: () => new Date(now), tokenFactory: () => "token-a", leaseMs: 90_000, generationTimeoutMs: 45_000, memoryStore: memories, memoryIdFactory: () => "mem_stale" });

    const firstRun = firstWorker.process(source.id);
    await Promise.resolve();
    now = new Date("2026-08-31T00:01:30.000Z");
    const secondGenerator: WenliReplyGenerator = { generate: vi.fn(async () => ({ reply: "第二个结果", memoryUpdate: "fresh memory" })) };
    await expect(workerWith(store, secondGenerator, { clock: () => new Date(now), tokenFactory: () => "token-b", memoryStore: memories, memoryIdFactory: () => "mem_fresh" }).process(source.id))
      .resolves.toMatchObject({ claimed: true, completed: true, message: expect.any(Object) });

    first.resolve({ reply: "旧结果", memoryUpdate: "stale memory" });
    await expect(firstRun).resolves.toEqual({ claimed: true, completed: false, message: null });

    await expect(store.source(reply(source, "x").id)).resolves.toMatchObject({ body: "第二个结果" });
    await expect(store.get(source.id)).resolves.toMatchObject({ status: "succeeded", responseMessageId: reply(source, "x").id });
    await expect(memories.listForContext(2)).resolves.toEqual([expect.objectContaining({ id: "mem_fresh", summary: "fresh memory" })]);
  });

  it("recovers an already-written reply on the later retry without a second generation call", async () => {
    const { store, messages } = memoryHarness();
    const source = mention("1001_uncertain");
    await seed(store, messages, source, { ...pendingJob(source), status: "running", attemptCount: 1, leaseToken: "lost", leaseUntil: "2026-08-31T00:01:30.000Z" });
    await messages.appendIfAbsent(reply(source, "提交成功但确认丢失"));
    const generator = generatorReturning("不应调用");
    const worker = workerWith(store, generator, { clock: () => new Date("2026-08-31T00:01:30.000Z") });

    await expect(worker.process(source.id)).resolves.toEqual({ claimed: false, message: null });

    expect(generator.generate).not.toHaveBeenCalled();
    await expect(store.get(source.id)).resolves.toMatchObject({ status: "succeeded" });
  });

  it("validates bounded worker options before claiming", async () => {
    const { store, messages } = memoryHarness();
    const source = mention("1001_options");
    await seed(store, messages, source, pendingJob(source));
    const generator = generatorReturning("不会调用");

    expect(() => workerWith(store, generator, { generationTimeoutMs: 90_000, leaseMs: 90_000 })).toThrow("invalid Wenli worker options");
    expect(() => workerWith(store, generator, { maxAttempts: 0 })).toThrow("invalid Wenli worker options");
    expect(() => workerWith(store, generator, { leaseMs: 2_147_483_648, generationTimeoutMs: 45_000 })).toThrow("invalid Wenli worker options");
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it("uses the same memory message store from ChatService trigger through worker reply", async () => {
    const messages = new MemoryMessageStore();
    const store = new MemoryWenliJobExecutionStore(messages);
    const clock = () => new Date(T0);
    const chat = new ChatService(messages, clock, new WenliTriggerService(store, messages, clock));
    const source = await chat.send("1001", "integrated", "@小Q 你能看到这条吗");
    const generator = generatorReturning("看到了");

    await expect(workerWith(store, generator).process(source.id)).resolves.toMatchObject({ claimed: true, completed: true, message: expect.any(Object) });

    const storedReply = await messages.get(reply(source, "x").id);
    expect(storedReply).toMatchObject({
      senderId: "wenli",
      recipientId: "1002",
      body: "看到了",
      replyToMessageId: source.id,
      sourceMessageId: source.id
    });
  });
});

function workerWith(
  store: MemoryWenliJobExecutionStore,
  generator: WenliReplyGenerator,
  overrides: Partial<ConstructorParameters<typeof WenliJobWorker>[0]> = {}
): WenliJobWorker {
  return new WenliJobWorker({
    store,
    generator,
    clock: () => new Date(T0),
    tokenFactory: () => "token-a",
    ...overrides
  });
}

async function seed(
  store: MemoryWenliJobExecutionStore,
  messages: MemoryMessageStore,
  source: MessageRecord,
  job: WenliAgentJob
): Promise<void> {
  await messages.appendIfAbsent(source);
  await store.createIfAbsent(job);
}

function memoryHarness(): { messages: MemoryMessageStore; store: MemoryWenliJobExecutionStore } {
  const messages = new MemoryMessageStore();
  return { messages, store: new MemoryWenliJobExecutionStore(messages) };
}

function pendingJob(source: MessageRecord): WenliAgentJob {
  return {
    id: source.id,
    type: "mention",
    requesterId: source.senderId as "1001" | "1002",
    sourceMessageId: source.id,
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: T0,
    createdAt: T0,
    updatedAt: T0
  };
}

function mention(id: string, overrides: Partial<MessageRecord> = {}): MessageRecord {
  const senderId = (overrides.senderId ?? id.slice(0, 4)) as "1001" | "1002";
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

function reply(source: MessageRecord, body: string): MessageRecord {
  const id = deterministicWenliReplyId(source.id);
  return {
    id,
    relationshipId: "couple",
    senderId: "wenli",
    recipientId: source.recipientId,
    clientMessageId: id.slice("wenli_".length),
    body,
    replyToMessageId: source.id,
    sourceMessageId: source.id,
    createdAt: T0
  };
}

function generatorReturning(body: string): WenliReplyGenerator {
  return { generate: vi.fn(async () => ({ reply: body, memoryUpdate: null })) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
