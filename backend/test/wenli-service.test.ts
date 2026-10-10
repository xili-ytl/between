import { describe, expect, it, vi } from "vitest";
import { MemoryMessageStore } from "../src/adapters/memory-stores.js";
import { MemoryWenliJobExecutionStore } from "../src/adapters/wenli-job-execution-stores.js";
import type { AccountId, MessageRecord } from "../src/domain/contracts.js";
import type { WenliAgentJob } from "../src/domain/wenli-agent.js";
import { deterministicWenliReplyId } from "../src/domain/wenli-reply.js";
import type { WenliTimingEvent } from "../src/domain/wenli-timing.js";
import type { WenliReplyGenerator } from "../src/ports/wenli-reply-generator.js";
import { WenliJobWorker } from "../src/services/wenli-job-worker.js";
import { WenliService } from "../src/services/wenli-service.js";
import { WenliTriggerService } from "../src/services/wenli-trigger-service.js";
import { MemoryWenliAgentJobStore } from "../src/adapters/wenli-agent-job-stores.js";
import { ChatService } from "../src/services/chat-service.js";
import { WenliPendingMentionInvalidError } from "../src/ports/wenli-mention-outbox.js";

const T0 = "2026-08-31T00:00:00.000Z";

describe("WenliService", () => {
  it("kicks a mention job, stores exactly one reply and wakes up both devices", async () => {
    const { service, messages, store, push, generator } = harness();
    const source = mention("1001_kick");
    await seed(store, messages, source);

    const result = await service.kick("1001", source.id);

    expect(result.processed).toBe(true);
    expect(result.messageId).toBe(deterministicWenliReplyId(source.id));
   expect(generator.generate).toHaveBeenCalledTimes(1);
   expect(push.pushWenli).toHaveBeenCalledTimes(1);
    expect(push.pushWenli).toHaveBeenCalledWith("小Q的回复", deterministicWenliReplyId(source.id), T0);
    await expect(messages.get(deterministicWenliReplyId(source.id))).resolves.toMatchObject({
      senderId: "wenli",
      body: "小Q的回复",
      sourceMessageId: source.id
    });
  });

  it("correlates materialization, kick receipt, lookup, worker and push stages", async () => {
    const messages = new MemoryMessageStore();
    const jobs = new MemoryWenliJobExecutionStore(messages);
    const events: WenliTimingEvent[] = [];
    let tick = 0;
    const sink = { record: (event: WenliTimingEvent) => events.push(event) };
    const trigger = new WenliTriggerService(jobs, messages, () => new Date(T0), sink, () => (tick += 3));
    const source = await new ChatService(messages, () => new Date(T0), trigger)
      .send("1001", "timing-service", "@小Q 记录一下阶段");
    const generator = generatorReturning("小Q的回复");
    const service = new WenliService(jobs, new WenliJobWorker({
      store: jobs,
      generator,
      clock: () => new Date(T0),
      tokenFactory: () => "token-timing",
      timingSink: sink,
      monotonicClock: () => (tick += 3)
    }), { pushWenli: vi.fn(async () => undefined) }, () => new Date(T0), undefined, {
      timingSink: sink,
      monotonicClock: () => (tick += 3)
    });

    await expect(service.kick("1001", source.id)).resolves.toMatchObject({ processed: true });
    expect(events.map((event) => event.stage)).toEqual(expect.arrayContaining([
      "job_materialize", "kick_total", "job_lookup", "claim", "source_load", "generation_total", "persist", "push"
    ]));
    expect(events.every((event) => event.requestId === source.id && event.jobId === source.id)).toBe(true);
    expect(JSON.stringify(events)).not.toContain(source.body);
  });

  it("rejects a kick for another account, an unknown source, or a non-mention job", async () => {
    const { service, messages, store } = harness();
    const source = mention("1002_kick");
    await seed(store, messages, source);

    await expect(service.kick("1001", source.id)).rejects.toMatchObject({ code: "WENLI_SOURCE_INVALID" });
    await expect(service.kick("1002", "1002_missing")).rejects.toMatchObject({ code: "WENLI_SOURCE_INVALID" });
    await expect(service.kick("1001", "")).rejects.toMatchObject({ code: "WENLI_SOURCE_INVALID" });
  });

  it("repeated kicks do not generate or push twice", async () => {
    const { service, messages, store, push, generator } = harness();
    const source = mention("1001_repeat");
    await seed(store, messages, source);

    const first = await service.kick("1001", source.id);
    const second = await service.kick("1001", source.id);

    expect(first.processed).toBe(true);
    expect(second).toMatchObject({ processed: true, messageId: deterministicWenliReplyId(source.id) });
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(push.pushWenli).toHaveBeenCalledTimes(1);
  });

  it("sweeps only due jobs and reports how many were claimed", async () => {
    const { service, messages, store, push } = harness();
    const due = mention("1001_due");
    const future = mention("1001_future", { createdAt: "2026-08-31T00:10:00.000Z" });
    await seed(store, messages, due);
    await messages.appendIfAbsent(future);
    // 未到期任务：nextAttemptAt 在未来，sweep 不应碰它。
    await store.createIfAbsent({
      ...pendingJob(future),
      status: "retry",
      attemptCount: 1,
      nextAttemptAt: "2026-08-31T01:00:00.000Z"
    });

    await expect(service.sweep(2)).resolves.toEqual({ processed: 1 });
    await expect(messages.get(deterministicWenliReplyId(due.id))).resolves.toMatchObject({ body: "小Q的回复" });
    await expect(messages.get(deterministicWenliReplyId(future.id))).resolves.toBeNull();
    expect(push.pushWenli).toHaveBeenCalledTimes(1);
  });

  it("does not claim another job when the remaining sweep budget is too small", async () => {
    const messages = new MemoryMessageStore();
    const jobs = new MemoryWenliAgentJobStore();
    const first = mention("1001_budget-a");
    const second = mention("1001_budget-b");
    await messages.appendIfAbsent(first);
    await messages.appendIfAbsent(second);
    await jobs.createIfAbsent(pendingJob(first));
    await jobs.createIfAbsent(pendingJob(second));
    let elapsed = 0;
    const worker = {
      process: vi.fn(async (id: string) => {
        if (id === first.id) elapsed = 4_900;
        return { claimed: true, message: null };
      })
    };
    const service = Reflect.construct(WenliService, [
      jobs,
      worker,
      undefined,
      () => new Date(T0),
      undefined,
      { sweepBudgetMs: 5_000, perJobBudgetMs: 3_000, monotonicClock: () => elapsed }
    ]) as WenliService;

    await expect(service.sweep(2)).resolves.toEqual({ processed: 1 });
    expect(worker.process).toHaveBeenCalledTimes(1);
    expect(worker.process).toHaveBeenCalledWith(first.id);
  });

  it("reconciles pending mentions before sweeping due jobs", async () => {
    const jobs = new MemoryWenliAgentJobStore();
    const messages = new MemoryMessageStore();
    const trigger = new WenliTriggerService(jobs, messages, () => new Date(T0));
    vi.spyOn(jobs, "createIfAbsent").mockRejectedValueOnce(new Error("temporary"));
    const worker = { process: vi.fn(async () => ({ claimed: true, message: null })) };
    const service = Reflect.construct(WenliService, [
      jobs,
      worker,
      undefined,
      () => new Date(T0),
      trigger
    ]) as WenliService;

    const source = await new ChatService(messages, () => new Date(T0), trigger)
      .send("1001", "pending-sweep", "@小Q 稍后回复");

    await expect(messages.getPendingMention(source.id)).resolves.toEqual(source);
    await expect(service.sweep(2)).resolves.toEqual({ processed: 1 });
    expect(worker.process).toHaveBeenCalledWith(source.id);
    await expect(messages.getPendingMention(source.id)).resolves.toBeNull();
  });

  it("does not let a full page of permanently invalid pending items starve the next valid item", async () => {
    const messages = new MemoryMessageStore();
    const jobs = new MemoryWenliAgentJobStore();
    const badIds = Array.from({ length: 100 }, (_, index) => `1001_bad-${String(index).padStart(3, "0")}`);
    const goodId = "1001_good-101";
    for (const id of [...badIds, goodId]) {
      await messages.appendIfAbsent(mention(id), { captureWenliMention: true });
    }
    const readPending = messages.getPendingMention.bind(messages);
    const badIdSet = new Set(badIds);
    vi.spyOn(messages, "getPendingMention").mockImplementation(async (id) => {
      if (badIdSet.has(id)) throw permanentInvalidPendingMention();
      return readPending(id);
    });
    const acknowledge = vi.spyOn(messages, "acknowledgeMention");
    const trigger = new WenliTriggerService(jobs, messages, () => new Date(T0));
    const worker = { process: vi.fn(async () => ({ claimed: true, message: null })) };
    const service = Reflect.construct(WenliService, [
      jobs,
      worker,
      undefined,
      () => new Date(T0),
      trigger
    ]) as WenliService;

    await expect(service.sweep(1)).resolves.toEqual({ processed: 0 });
    await expect(service.sweep(1)).resolves.toEqual({ processed: 1 });
    expect(worker.process).toHaveBeenCalledWith(goodId);
    expect(acknowledge.mock.calls.map(([id]) => id)).toEqual([...badIds, goodId]);
    expect(await messages.pendingMentionIds(null, 200)).toEqual([]);
    for (const id of badIds) {
      await expect(messages.get(id)).resolves.toMatchObject({ id, body: "@小Q 在吗" });
    }
  });

  it("bounds the sweep page size", async () => {
    const { service } = harness();
    for (const limit of [0, 6, 1.5, Number.NaN]) {
      await expect(service.sweep(limit)).rejects.toMatchObject({ code: "PAGE_SIZE_INVALID" });
    }
    await expect(service.sweep(1)).resolves.toEqual({ processed: 0 });
  });

  it("keeps the reply durable when pushing fails", async () => {
    const { service, messages, store, push } = harness();
    push.pushWenli.mockRejectedValueOnce(new Error("push down"));
    const source = mention("1001_pushfail");
    await seed(store, messages, source);

    await expect(service.kick("1001", source.id)).resolves.toMatchObject({ processed: true });
    await expect(messages.get(deterministicWenliReplyId(source.id))).resolves.toMatchObject({ body: "小Q的回复" });
  });

  it("works without a push service configured", async () => {
    const messages = new MemoryMessageStore();
    const store = new MemoryWenliJobExecutionStore(messages);
    const generator = generatorReturning("小Q的回复");
    const service = new WenliService(store, workerWith(store, generator), undefined, () => new Date(T0));
    const source = mention("1001_nopush");
    await messages.appendIfAbsent(source);
    await store.createIfAbsent(pendingJob(source));

    await expect(service.kick("1001", source.id)).resolves.toMatchObject({ processed: true });
  });

  it("rejects a kick whose durable job is missing or owned by the other account", async () => {
    const { service, store } = harness();
    // 只有 job、没有来源消息：worker 会把来源判为无效，但 kick 本身先做归属校验。
    await store.createIfAbsent({
      ...pendingJob(mention("1001_jobonly")),
      requesterId: "1002"
    });
    await expect(service.kick("1001", "1001_jobonly")).rejects.toMatchObject({ code: "WENLI_SOURCE_INVALID" });
  });

  it("accepts a kick from the other account for its own mention", async () => {
    const { service, messages, store } = harness();
    const source = mention("1002_own");
    await seed(store, messages, source);
    await expect(service.kick("1002", source.id)).resolves.toMatchObject({ processed: true });
  });
});

function harness(): {
  service: WenliService;
  messages: MemoryMessageStore;
  store: MemoryWenliJobExecutionStore;
  push: { pushWenli: ReturnType<typeof vi.fn> };
  generator: WenliReplyGenerator & { generate: ReturnType<typeof vi.fn> };
} {
  const messages = new MemoryMessageStore();
  const store = new MemoryWenliJobExecutionStore(messages);
  const generator = generatorReturning("小Q的回复");
  const push = { pushWenli: vi.fn(async () => undefined) };
  const service = new WenliService(store, workerWith(store, generator), push, () => new Date(T0));
  return { service, messages, store, push, generator };
}

function workerWith(store: MemoryWenliJobExecutionStore, generator: WenliReplyGenerator): WenliJobWorker {
  return new WenliJobWorker({
    store,
    generator,
    clock: () => new Date(T0),
    tokenFactory: () => "token-a"
  });
}

function generatorReturning(reply: string): WenliReplyGenerator & { generate: ReturnType<typeof vi.fn> } {
  const generate = vi.fn(async () => ({ reply, memoryUpdate: null }));
  return { generate } as unknown as WenliReplyGenerator & { generate: ReturnType<typeof vi.fn> };
}

async function seed(store: MemoryWenliJobExecutionStore, messages: MemoryMessageStore, source: MessageRecord): Promise<void> {
  await messages.appendIfAbsent(source);
  await store.createIfAbsent(pendingJob(source));
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
  return {
    id,
    relationshipId: "couple",
    senderId,
    recipientId: senderId === "1001" ? "1002" : "1001",
    clientMessageId: id.slice(5),
    body: "@小Q 在吗",
    createdAt: T0,
    ...overrides
  };
}

function permanentInvalidPendingMention(): Error {
  return new WenliPendingMentionInvalidError();
}
