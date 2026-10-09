import { describe, expect, it, vi } from "vitest";
import { MemoryMessageStore } from "../src/adapters/memory-stores.js";
import { MemoryWenliJobExecutionStore } from "../src/adapters/wenli-job-execution-stores.js";
import type { AccountId, MessageRecord } from "../src/domain/contracts.js";
import type { WenliAgentJob } from "../src/domain/wenli-agent.js";
import type { WenliReplyGenerator } from "../src/ports/wenli-reply-generator.js";
import { WenliJobWorker } from "../src/services/wenli-job-worker.js";
import { WenliService } from "../src/services/wenli-service.js";

const T0 = "2026-08-31T00:00:00.000Z";

describe("WenliService concurrency", () => {
  it("concurrent kick and sweep produce exactly one reply and one push", async () => {
    const messages = new MemoryMessageStore();
    const store = new MemoryWenliJobExecutionStore(messages);
    const source = mention("1001_race");
    await messages.appendIfAbsent(source);
    await store.createIfAbsent(pendingJob(source));

    let generateCalls = 0;
    const generator: WenliReplyGenerator = {
      generate: async () => {
        generateCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { reply: "唯一一条", memoryUpdate: null };
      }
    };
    const push = { pushWenli: vi.fn(async () => undefined) };
    const service = new WenliService(
      store,
      new WenliJobWorker({ store, generator, clock: () => new Date(T0), tokenFactory: () => `t${Math.random()}` }),
      push,
      () => new Date(T0)
    );

    await Promise.all([service.kick("1001", source.id), service.sweep(2), service.kick("1001", source.id)]);

    expect(generateCalls).toBe(1);
    expect(push.pushWenli).toHaveBeenCalledTimes(1);
    const all = await messages.before(null, 50);
    expect(all.filter((message) => message.senderId === "wenli")).toHaveLength(1);
  });
});

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

function mention(id: string): MessageRecord {
  const senderId = id.slice(0, 4) as AccountId;
  return {
    id,
    relationshipId: "couple",
    senderId,
    recipientId: senderId === "1001" ? "1002" : "1001",
    clientMessageId: id.slice(5),
    body: "@问理 在吗",
    createdAt: T0
  };
}
