import { describe, expect, it } from "vitest";
import { MemoryWenliAgentJobStore } from "../src/adapters/wenli-agent-job-stores.js";
import { MemoryMessageStore } from "../src/adapters/memory-stores.js";
import { IMAGE_MESSAGE_PLACEHOLDER } from "../src/domain/contracts.js";
import type { MessageRecord } from "../src/domain/contracts.js";
import { isHumanWenliMention } from "../src/domain/wenli-mention.js";
import { WenliTriggerService, isWenliMention } from "../src/services/wenli-trigger-service.js";

const NOW = new Date("2026-08-30T00:00:00.000Z");

function humanMessage(body: string, overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: "1001_source-1",
    relationshipId: "couple",
    senderId: "1001",
    recipientId: "1002",
    clientMessageId: "source-1",
    body,
    createdAt: NOW.toISOString(),
    ...overrides
  };
}

describe("isWenliMention", () => {
  it.each([
    "@问理",
    "  @问理 在吗",
    "@问理：帮我看看",
    "@问理, 你好",
    "@问理，过来一下",
    "@问理: hello",
    "前文 @问理 后文"
  ])("accepts an explicit mention token: %s", (body) => {
    expect(isWenliMention(body)).toBe(true);
  });

  it.each([
    "问理 在吗",
    "今天@问理在吗",
    "@问理啊",
    "前文 @问理你好",
    IMAGE_MESSAGE_PLACEHOLDER
  ])("rejects text that is not an explicit leading mention: %s", (body) => {
    expect(isWenliMention(body)).toBe(false);
  });

  it("materializes a middle mention while preserving the source body", async () => {
    const jobs = new MemoryWenliAgentJobStore();
    const messages = new MemoryMessageStore();
    const service = new WenliTriggerService(jobs, messages, () => new Date(NOW));
    const source = await messages.appendIfAbsent(humanMessage("前文 @问理 后文", {
      id: "1001_middle-1",
      clientMessageId: "middle-1"
    }), { captureWenliMention: true });

    await expect(service.afterHumanMessage(source)).resolves.toMatchObject({
      id: source.id,
      sourceMessageId: source.id,
      requesterId: "1001",
      status: "pending"
    });
    await expect(messages.get(source.id)).resolves.toMatchObject({ body: "前文 @问理 后文" });
  });
});

describe("WenliTriggerService", () => {
  it("creates one deterministic pending mention job for repeated delivery", async () => {
    const jobs = new MemoryWenliAgentJobStore();
    const messages = new MemoryMessageStore();
    const service = new WenliTriggerService(jobs, messages, () => new Date(NOW));
    const message = await messages.appendIfAbsent(humanMessage("@问理 在吗"), { captureWenliMention: true });

    const first = await service.afterHumanMessage(message);
    const retried = await service.afterHumanMessage(message);

    expect(first).toEqual({
      id: message.id,
      type: "mention",
      requesterId: "1001",
      sourceMessageId: message.id,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: NOW.toISOString(),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    });
    expect(retried).toBeNull();
    expect(await jobs.get(message.id)).toEqual(first);
  });

  it("ignores normal text, non-mention image messages, and Wenli-origin messages", async () => {
    const jobs = new MemoryWenliAgentJobStore();
    const messages = new MemoryMessageStore();
    const service = new WenliTriggerService(jobs, messages, () => new Date(NOW));

    await expect(service.afterHumanMessage(await messages.appendIfAbsent(humanMessage("普通聊天"), { captureWenliMention: true }))).resolves.toBeNull();
    await expect(service.afterHumanMessage(await messages.appendIfAbsent(humanMessage(IMAGE_MESSAGE_PLACEHOLDER, {
      id: "1001_image-1",
      clientMessageId: "image-1",
      type: "image",
      imageFileId: "cloud://env/chat-images/1001_image-1.jpg",
      imageMimeType: "image/jpeg"
    }), { captureWenliMention: true }))).resolves.toBeNull();
    await expect(service.afterHumanMessage(await messages.appendIfAbsent(humanMessage("@问理 我是问理", {
      id: "wenli_reply-1",
      senderId: "wenli",
      clientMessageId: "reply-1",
      replyToMessageId: "1001_source-1",
      sourceMessageId: "1001_source-1"
    }), { captureWenliMention: true }))).resolves.toBeNull();

    expect(await jobs.get("1001_source-1")).toBeNull();
    expect(await jobs.get("1001_image-1")).toBeNull();
    expect(await jobs.get("wenli_reply-1")).toBeNull();
  });

  it("materializes a captioned image @问理 mention and ignores the placeholder", async () => {
    const jobs = new MemoryWenliAgentJobStore();
    const messages = new MemoryMessageStore();
    const service = new WenliTriggerService(jobs, messages, () => new Date(NOW));

    const captioned = await messages.appendIfAbsent(humanMessage("@问理 看看这张图", {
      id: "1001_image-mention",
      clientMessageId: "image-mention",
      type: "image",
      imageFileId: "cloud://env/chat-images/1001_image-mention.jpg",
      imageMimeType: "image/jpeg"
    }), { captureWenliMention: true });
    expect(isHumanWenliMention(captioned)).toBe(true);

    const job = await service.afterHumanMessage(captioned);
    expect(job).toEqual({
      id: captioned.id,
      type: "mention",
      requesterId: "1001",
      sourceMessageId: captioned.id,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: NOW.toISOString(),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    });

    const placeholder = await messages.appendIfAbsent(humanMessage(IMAGE_MESSAGE_PLACEHOLDER, {
      id: "1001_image-placeholder",
      clientMessageId: "image-placeholder",
      type: "image",
      imageFileId: "cloud://env/chat-images/1001_image-placeholder.jpg",
      imageMimeType: "image/jpeg"
    }), { captureWenliMention: true });
    expect(isHumanWenliMention(placeholder)).toBe(false);
    await expect(service.afterHumanMessage(placeholder)).resolves.toBeNull();
  });
});
