import { describe, expect, it, vi } from "vitest";
import { MemoryMessageStore } from "../src/adapters/memory-stores.js";
import { MemoryWenliAgentJobStore } from "../src/adapters/wenli-agent-job-stores.js";
import { ChatService } from "../src/services/chat-service.js";
import { WenliTriggerService } from "../src/services/wenli-trigger-service.js";
import { WenliPendingMentionInvalidError } from "../src/ports/wenli-mention-outbox.js";
import type { MessageRecord } from "../src/domain/contracts.js";
import type { WenliAgentJob } from "../src/domain/wenli-agent.js";

const NOW = "2026-08-31T00:00:00.000Z";
const clock = () => new Date(NOW);

function mention(clientMessageId = "source", overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: `1001_${clientMessageId}`, relationshipId: "couple", senderId: "1001", recipientId: "1002",
    clientMessageId, body: "@问理 在吗", createdAt: NOW, ...overrides
  };
}

function fixture() {
  const jobs = new MemoryWenliAgentJobStore();
  const messages = new MemoryMessageStore();
  return { jobs, messages, trigger: new WenliTriggerService(jobs, messages, clock) };
}

describe("durable Wenli mention outbox", () => {
  it("recovers an accepted mention after enqueue failure using a new trigger instance", async () => {
    const jobs = new MemoryWenliAgentJobStore();
    const messages = new MemoryMessageStore();
    const trigger = new WenliTriggerService(jobs, messages, clock);
    vi.spyOn(jobs, "createIfAbsent").mockRejectedValueOnce(new Error("temporary"));

    const source = await new ChatService(messages, clock, trigger).send("1001", "recover", "@问理 在吗");

    expect(await messages.get(source.id)).toEqual(source);
    expect(await jobs.get(source.id)).toBeNull();
    expect(await messages.getPendingMention(source.id)).toEqual(source);
    const restarted = new WenliTriggerService(jobs, messages, clock);
    expect(await restarted.reconcilePending(null, 50)).toEqual({
      scanned: 1, recovered: 1, failed: 0, nextCursor: source.id
    });
    expect(await jobs.get(source.id)).toMatchObject({ status: "pending" });
    expect(await messages.getPendingMention(source.id)).toBeNull();
    expect(await messages.get(source.id)).toEqual(source);
  });

  it("retries acknowledgement without replacing the already-created job", async () => {
    const { jobs, messages, trigger } = fixture();
    vi.spyOn(messages, "acknowledgeMention").mockRejectedValueOnce(new Error("temporary"));
    const source = await new ChatService(messages, clock, trigger).send("1001", "ack", "@问理 在吗");
    const job = await jobs.get(source.id);
    expect(job).toMatchObject({ status: "pending" });
    expect(await messages.getPendingMention(source.id)).toEqual(source);
    expect(await new WenliTriggerService(jobs, messages, () => new Date("2026-09-01T00:00:00.000Z"))
      .reconcilePending(null, 50)).toMatchObject({ recovered: 1, failed: 0 });
    expect(await jobs.get(source.id)).toEqual(job);
    expect(await messages.getPendingMention(source.id)).toBeNull();
  });

  it("materializes one job for concurrent duplicate callbacks", async () => {
    const { jobs, messages, trigger } = fixture();
    const source = await messages.appendIfAbsent(mention(), { captureWenliMention: true });
    const delivered = await Promise.all(Array.from({ length: 10 }, () => trigger.afterHumanMessage(source)));
    expect(delivered.every((job) => job === null || job.id === source.id)).toBe(true);
    expect(await jobs.get(source.id)).toMatchObject({ id: source.id, requesterId: "1001", attemptCount: 0 });
    expect(await messages.pendingMentionIds(null, 50)).toEqual([]);
    expect(await trigger.afterHumanMessage(source)).toBeNull();
  });

  it("does not notify an observer or capture a marker when append fails", async () => {
    const { messages, trigger } = fixture();
    const observed = vi.spyOn(trigger, "afterHumanMessage");
    vi.spyOn(messages, "appendIfAbsent").mockRejectedValueOnce(new Error("append failed"));
    await expect(new ChatService(messages, clock, trigger).send("1001", "failed", "@问理 在吗"))
      .rejects.toThrow("append failed");
    expect(observed).not.toHaveBeenCalled();
    expect(await messages.get("1001_failed")).toBeNull();
    expect(await messages.pendingMentionIds(null, 50)).toEqual([]);
  });

  it.each([
    mention("ordinary", { body: "普通消息" }),
    mention("image", { body: "普通图片", type: "image", imageFileId: "cloud://env/chat-images/1001_image.jpg", imageMimeType: "image/jpeg" }),
    mention("reply", { id: "wenli_reply", senderId: "wenli", sourceMessageId: "1001_source", replyToMessageId: "1001_source" })
  ])("never captures ineligible messages: $id", async (source) => {
    const { jobs, messages, trigger } = fixture();
    await messages.appendIfAbsent(source, { captureWenliMention: true });
    expect(await messages.getPendingMention(source.id)).toBeNull();
    expect(await trigger.afterHumanMessage(source)).toBeNull();
    expect(await jobs.get(source.id)).toBeNull();
  });

  it.each(["@问理 在关闭期间发送", "之前的普通消息"])("does not arm a duplicate originally sent with triggering disabled: %s", async (body) => {
    const { jobs, messages, trigger } = fixture();
    const original = await new ChatService(messages, clock).send("1001", "disabled", body);
    const retried = await new ChatService(messages, clock, trigger).send("1001", "disabled", "@问理 新正文");
    expect(retried).toEqual(original);
    expect(await messages.getPendingMention(original.id)).toBeNull();
    expect(await trigger.reconcilePending(null, 50)).toEqual({ scanned: 0, recovered: 0, failed: 0, nextCursor: null });
    expect(await jobs.get(original.id)).toBeNull();
  });

  it("uses only the durable body and requester, ignoring forged callback fields", async () => {
    const { jobs, messages, trigger } = fixture();
    const source = await messages.appendIfAbsent(mention(), { captureWenliMention: true });
    await trigger.afterHumanMessage({ ...source, body: "not a mention", senderId: "1002" });
    expect(await jobs.get(source.id)).toMatchObject({ requesterId: "1001", sourceMessageId: source.id });
    expect(await messages.get(source.id)).toEqual(source);
    expect(await trigger.afterHumanMessage(mention("never-stored"))).toBeNull();
  });

  it.each([
    { id: "wrong" }, { type: "warmup" }, { requesterId: "1002" }, { sourceMessageId: "1001_other" }
  ])("retains the marker when an existing job has a different identity: %j", async (override) => {
    const { jobs, messages, trigger } = fixture();
    const source = await messages.appendIfAbsent(mention(), { captureWenliMention: true });
    const conflict = {
      id: source.id, type: "mention", requesterId: "1001", sourceMessageId: source.id,
      status: "succeeded", attemptCount: 1, createdAt: NOW, updatedAt: NOW, ...override
    } as WenliAgentJob;
    if (override.id) {
      vi.spyOn(jobs, "createIfAbsent").mockResolvedValueOnce(conflict);
    } else {
      await jobs.createIfAbsent(conflict);
    }
    await expect(trigger.afterHumanMessage(source)).rejects.toThrow("invalid Wenli mention job identity");
    expect(await messages.getPendingMention(source.id)).toEqual(source);
  });

  it("keeps internal capture metadata out of all public memory reads and returns defensive copies", async () => {
    const { messages } = fixture();
    const source = mention();
    const appended = await messages.appendIfAbsent({ ...source, wenliMentionPending: false } as MessageRecord,
      { captureWenliMention: true });
    for (const value of [appended, await messages.get(source.id), ...(await messages.after(null, 50)),
      ...(await messages.before(null, 50)), await messages.getPendingMention(source.id)]) {
      expect(value).toEqual(source);
      expect(value).not.toHaveProperty("wenliMentionPending");
    }
    appended.body = "mutated";
    const pending = (await messages.getPendingMention(source.id))!;
    pending.body = "also mutated";
    expect(await messages.get(source.id)).toEqual(source);
    await messages.acknowledgeMention(source.id);
    await messages.appendIfAbsent(source, { captureWenliMention: true });
    expect(await messages.getPendingMention(source.id)).toBeNull();
    await expect(messages.acknowledgeMention("absent")).resolves.toBeUndefined();
  });

  it("does not accept caller-supplied metadata as server authorization to capture", async () => {
    const { messages } = fixture();
    const source = mention();
    expect(await messages.appendIfAbsent({ ...source, wenliMentionPending: true } as MessageRecord)).toEqual(source);
    expect(await messages.getPendingMention(source.id)).toBeNull();
    expect(await messages.pendingMentionIds(null, 50)).toEqual([]);
  });

  it("acknowledges a permanently invalid candidate without deleting its message body", async () => {
    const { jobs, messages, trigger } = fixture();
    const bad = await messages.appendIfAbsent(mention("a"), { captureWenliMention: true });
    const good = await messages.appendIfAbsent(mention("b"), { captureWenliMention: true });
    const acknowledge = vi.spyOn(messages, "acknowledgeMention");
    vi.spyOn(messages, "getPendingMention").mockResolvedValueOnce({ ...bad, id: "forged" });
    expect(await trigger.reconcilePending(null, 50)).toEqual({ scanned: 2, recovered: 1, failed: 1, nextCursor: good.id });
    expect(await jobs.get(bad.id)).toBeNull();
    expect(await jobs.get(good.id)).toMatchObject({ status: "pending" });
    expect(acknowledge).toHaveBeenCalledWith(bad.id);
    expect(await messages.get(bad.id)).toEqual(bad);
    expect(await messages.pendingMentionIds(null, 50)).toEqual([]);
  });

  it("advances past a failed first page and returns to pending lower IDs on a new sweep", async () => {
    const { jobs, messages, trigger } = fixture();
    const first = await messages.appendIfAbsent(mention("a"), { captureWenliMention: true });
    const second = await messages.appendIfAbsent(mention("b"), { captureWenliMention: true });
    vi.spyOn(jobs, "createIfAbsent").mockRejectedValueOnce(new Error("temporary"));
    expect(await trigger.reconcilePending(null, 1)).toEqual({ scanned: 1, recovered: 0, failed: 1, nextCursor: first.id });
    expect(await trigger.reconcilePending(first.id, 1)).toEqual({ scanned: 1, recovered: 1, failed: 0, nextCursor: second.id });
    const empty = await trigger.reconcilePending(second.id, 1);
    expect(empty).toEqual({ scanned: 0, recovered: 0, failed: 0, nextCursor: null });
    const late = await messages.appendIfAbsent(mention("0-late"), { captureWenliMention: true });
    expect(await trigger.reconcilePending(empty.nextCursor, 50)).toEqual({ scanned: 2, recovered: 2, failed: 0, nextCursor: first.id });
    expect(await jobs.get(late.id)).toMatchObject({ status: "pending" });
  });

  it.each([0, -1, 101, 1.5, NaN, Infinity])("rejects invalid page limit %s before reading persistence", async (limit) => {
    const { messages, trigger } = fixture();
    const read = vi.spyOn(messages, "pendingMentionIds");
    await expect(trigger.reconcilePending(null, limit)).rejects.toThrow("invalid Wenli mention page");
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["", "x".repeat(201), 7, undefined])("rejects invalid cursor %s before reading persistence", async (cursor) => {
    const { messages, trigger } = fixture();
    const read = vi.spyOn(messages, "pendingMentionIds");
    await expect(trigger.reconcilePending(cursor as string, 50)).rejects.toThrow("invalid Wenli mention page");
    expect(read).not.toHaveBeenCalled();
  });
});

function permanentInvalidPendingMention(): Error {
  return new WenliPendingMentionInvalidError();
}
