import { describe, expect, it } from "vitest";
import { MemoryMessageStore } from "../src/adapters/memory-stores.js";
import { MemoryWenliMemoryStore } from "../src/adapters/wenli-memory-stores.js";
import { MemoryWenliJobExecutionStore } from "../src/adapters/wenli-job-execution-stores.js";
import type { DeepSeekVisionCompletionClient, DeepSeekVisionMessage } from "../src/adapters/deepseek-vision-client.js";
import type { MessageRecord } from "../src/domain/contracts.js";
import { DeepSeekVisionReplyGenerator } from "../src/services/deepseek-vision-reply-generator.js";
import { WenliJobWorker } from "../src/services/wenli-job-worker.js";

describe("Wenli isolated memory lifecycle", () => {
  it.each([
    { accountId: "1001", historySize: 1 }, { accountId: "1002", historySize: 1 },
    { accountId: "1001", historySize: 40 }, { accountId: "1002", historySize: 40 }
  ] as const)("persists, recalls, corrects and forgets $accountId facts with history size $historySize", async ({ accountId, historySize }) => {
    const messages = new MemoryMessageStore();
    const memories = new MemoryWenliMemoryStore();
    const jobs = new MemoryWenliJobExecutionStore(messages);
    const requests: DeepSeekVisionMessage[][] = [];
    const output: unknown[] = [];
    let now = new Date("2026-09-30T04:00:00.000Z");
    const client: DeepSeekVisionCompletionClient = { complete: async request => {
      requests.push(request);
      return JSON.stringify({ reply: "我明白啦。", memoryUpdate: output.shift() ?? null });
    } };
    const generator = new DeepSeekVisionReplyGenerator(client, messages, { imageBytes: async () => null }, memories,
      async () => ({ "1001": "示例乙", "1002": "示例甲" }),
      { maxContextMessages: historySize, maxMemories: 4, maxImages: 1, maxImageBytes: 1024 });
    const worker = new WenliJobWorker({ store: jobs, generator, memoryStore: memories, clock: () => now });
    const turn = async (id: string, body: string, candidate: unknown = null) => {
      now = new Date(now.getTime() + 60_000);
      const source: MessageRecord = {
        id: `${accountId}_${id}`, senderId: accountId, recipientId: accountId === "1001" ? "1002" : "1001",
        relationshipId: "couple", clientMessageId: id, body, createdAt: now.toISOString()
      };
      await messages.appendIfAbsent(source);
      await jobs.createIfAbsent({ id: source.id, type: "mention", requesterId: accountId, sourceMessageId: source.id,
        status: "pending", attemptCount: 0, nextAttemptAt: source.createdAt, createdAt: source.createdAt, updatedAt: source.createdAt });
      output.push(candidate);
      expect(await worker.process(source.id)).toMatchObject({ completed: true });
      return (requests.at(-1)![1]!.content as Array<{ text: string }>)[0]!.text;
    };
    const candidate = { quote: "我喜欢蓝色杯子", subjectId: accountId, topicKey: "preference.cup", kind: "preference", operation: "remember" };
    await turn("remember", "@小Q 记住，我喜欢蓝色杯子，好吗？", candidate);
    expect(await memories.listForContext(200)).toMatchObject([{ subjectId: accountId, sourceEventIds: [`${accountId}_remember`] }]);
    await turn("hello", "@小Q 你好呀");
    const recalled = await turn("recall", "@小Q 我喜欢哪个颜色的杯子？");
    expect(recalled.split("History in chronological order:")[0]).toContain("我喜欢蓝色杯子");
    if (historySize === 1) expect(recalled.split("History in chronological order:")[1]).not.toContain("我喜欢蓝色杯子");
    const keepPrompt = await turn("keep", "@小Q 不要忘记我的杯子偏好", { ...candidate, quote: "不要忘记我的杯子偏好", operation: "forget" });
    expect(keepPrompt).toContain("Verified memory command (application metadata): none");
    expect(await memories.listForContext(200)).toMatchObject([{ sourceEventIds: [`${accountId}_remember`] }]);
    await turn("correct", "@小Q 纠正一下，我现在喜欢绿色杯子", { ...candidate, quote: "我现在喜欢绿色杯子", operation: "correct" });
    await turn("hello2", "@小Q 你好呀");
    const corrected = await turn("recall2", "@小Q 我喜欢哪个颜色的杯子？");
    expect(corrected).toContain("我现在喜欢绿色杯子");
    expect(corrected).not.toContain("我喜欢蓝色杯子");
    // Live MiMo sometimes acknowledges forgetting but emits no candidate at all.
    const forgetPrompt = await turn("forget", "@小Q 忘记我的杯子偏好", null);
    expect(forgetPrompt).toContain(`Verified memory command (application metadata): {"operation":"forget","subjectId":"${accountId}","topicKey":"preference.cup","eligible":true}`);
    await turn("hello3", "@小Q 你好呀");
    const forgotten = await turn("recall3", "@小Q 我喜欢哪个颜色的杯子？");
    expect(forgotten).not.toContain("我喜欢蓝色杯子");
    expect(forgotten).not.toContain("我现在喜欢绿色杯子");
    expect(await memories.listForContext(200)).toEqual([]);
    expect(await messages.get(`${accountId}_remember`)).not.toBeNull();
    expect(await messages.get(`${accountId}_correct`)).not.toBeNull();
  });

  it("does not adopt a model-written human fact without an exact current human quote", async () => {
    const { buildSourcedMemory } = await import("../src/domain/wenli-memory-candidate.js");
    const source: MessageRecord = { id: "1002_ask", clientMessageId: "ask", senderId: "1002", recipientId: "1001", relationshipId: "couple", body: "@小Q 我喜欢什么杯子", createdAt: "2026-09-30T04:00:00.000Z" };
    expect(buildSourcedMemory({ quote: "我喜欢绿色杯子", subjectId: "1002", topicKey: "preference.cup", kind: "preference", operation: "remember" }, source)).toBeNull();
  });
});
