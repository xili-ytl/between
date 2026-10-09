import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryMessageStore } from "../src/adapters/memory-stores.js";
import type { ImageMimeType } from "../src/domain/contracts.js";
import { ChatService } from "../src/services/chat-service.js";
import type { HumanMessageObserver } from "../src/services/wenli-trigger-service.js";

describe("ChatService", () => {
  let messages: MemoryMessageStore;
  let now: Date;
  let service: ChatService;

  beforeEach(() => {
    messages = new MemoryMessageStore();
    now = new Date("2026-08-06T00:00:00.000Z");
    service = new ChatService(messages, () => new Date(now));
  });

  it("routes each message to the other fixed account", async () => {
    const fromHer = await service.send("1001", "client-1", "你好");
    const fromHim = await service.send("1002", "client-2", "在呢");

    expect(fromHer).toMatchObject({
      id: "1001_client-1",
      relationshipId: "couple",
      senderId: "1001",
      recipientId: "1002",
      body: "你好"
    });
    expect(fromHim).toMatchObject({ senderId: "1002", recipientId: "1001" });
  });

  it("is idempotent and never overwrites an existing message", async () => {
    const original = await service.send("1001", "same-request", "第一条内容");
    now = new Date("2026-08-06T01:00:00.000Z");
    const retried = await service.send("1001", "same-request", "不同内容也不能覆盖");

    expect(retried).toEqual(original);
    expect(await messages.count()).toBe(1);
  });

  it("notifies the human-message observer only after the message is durable", async () => {
    const observer: HumanMessageObserver = {
      afterHumanMessage: vi.fn(async (message) => {
        expect(await messages.get(message.id)).toEqual(message);
        return null;
      })
    };
    const observedService = new ChatService(messages, () => new Date(now), observer);

    const sent = await observedService.send("1001", "observed-1", "@问理 在吗");

    expect(observer.afterHumanMessage).toHaveBeenCalledOnce();
    expect(observer.afterHumanMessage).toHaveBeenCalledWith(sent);
  });

  it("keeps an accepted message when the post-persistence observer fails", async () => {
    const observer: HumanMessageObserver = {
      afterHumanMessage: vi.fn(async () => {
        throw new Error("temporary trigger failure");
      })
    };
    const observedService = new ChatService(messages, () => new Date(now), observer);

    const sent = await observedService.send("1001", "observed-2", "@问理 帮帮我");

    expect(await messages.get(sent.id)).toEqual(sent);
    expect(observer.afterHumanMessage).toHaveBeenCalledOnce();
  });

  it("stores an immutable reference to a message in the same conversation", async () => {
    const original = await service.send("1001", "original", "第一条消息");
    const reply = await service.send("1002", "reply", "引用回复", original.id);

    expect(reply).toMatchObject({
      senderId: "1002",
      body: "引用回复",
      replyToMessageId: original.id
    });
  });

  it("writes one deterministic Wenli reply linked to the human trigger", async () => {
    const source = await service.send("1001", "ask-1", "@问理 在吗");
    const first = await service.sendAsWenli("1001", source.id, "在呢，怎么啦？");
    now = new Date("2026-08-30T01:00:00.000Z");
    const retried = await service.sendAsWenli("1001", source.id, "重试不能覆盖");

    expect(first).toMatchObject({
      senderId: "wenli",
      recipientId: "1002",
      body: "在呢，怎么啦？",
      replyToMessageId: source.id,
      sourceMessageId: source.id
    });
    expect(first.id).toMatch(/^wenli_reply_[a-f0-9]{32}$/);
    expect(retried).toEqual(first);
    expect(await messages.count()).toBe(2);
  });

  it("preserves legacy Wenli reply behavior for any matching human source", async () => {
    const source = await service.send("1001", "ordinary-source", "普通消息");
    const reply = await service.sendAsWenli("1001", source.id, "仍然可以回复");

    expect(reply).toMatchObject({
      senderId: "wenli",
      recipientId: "1002",
      body: "仍然可以回复",
      replyToMessageId: source.id,
      sourceMessageId: source.id
    });
  });

  it("rejects missing, mismatched, Wenli-origin, blank, and oversized replies", async () => {
    const source = await service.send("1001", "ask-2", "@问理 在吗");
    await expect(service.sendAsWenli("1002", source.id, "不匹配"))
      .rejects.toMatchObject({ code: "WENLI_SOURCE_INVALID" });
    await expect(service.sendAsWenli("1001", "missing", "不存在"))
      .rejects.toMatchObject({ code: "WENLI_SOURCE_INVALID" });
    await expect(service.sendAsWenli("1001", source.id, " \n "))
      .rejects.toMatchObject({ code: "WENLI_REPLY_INVALID" });
    await expect(service.sendAsWenli("1001", source.id, "问".repeat(4001)))
      .rejects.toMatchObject({ code: "WENLI_REPLY_INVALID" });

    const reply = await service.sendAsWenli("1001", source.id, "第一次回复");
    await expect(service.sendAsWenli("1001", reply.id, "不能回复问理自己"))
      .rejects.toMatchObject({ code: "WENLI_SOURCE_INVALID" });
  });

  it("rejects a quoted message id that does not exist", async () => {
    await expect(service.send("1001", "reply", "引用回复", "missing"))
      .rejects.toMatchObject({ code: "REPLY_MESSAGE_INVALID" });
  });

  it("accepts only non-blank text of at most 2000 Unicode characters", async () => {
    await expect(service.send("1001", "empty", "  \n ")).rejects.toMatchObject({ code: "MESSAGE_INVALID" });
    await expect(service.send("1001", "large", "喵".repeat(2001))).rejects.toMatchObject({ code: "MESSAGE_INVALID" });
    await expect(service.send("1001", "bad/id", "hello")).rejects.toMatchObject({ code: "MESSAGE_ID_INVALID" });

    await expect(service.send("1001", "max", "🐱".repeat(2000))).resolves.toMatchObject({
      body: "🐱".repeat(2000)
    });
  });

  it("paginates newer and older messages without gaps", async () => {
    for (let index = 1; index <= 5; index += 1) {
      now = new Date(`2026-08-06T00:00:0${index}.000Z`);
      await service.send(index % 2 === 0 ? "1002" : "1001", `m-${index}`, `消息${index}`);
    }

    const firstNewer = await service.after(null, 2);
    const secondNewer = await service.after(firstNewer.nextCursor, 2);
    const latestOlder = await service.before(null, 2);
    const previousOlder = await service.before(latestOlder.nextCursor, 2);

    expect(firstNewer.items.map((item) => item.body)).toEqual(["消息1", "消息2"]);
    expect(secondNewer.items.map((item) => item.body)).toEqual(["消息3", "消息4"]);
    expect(latestOlder.items.map((item) => item.body)).toEqual(["消息4", "消息5"]);
    expect(previousOlder.items.map((item) => item.body)).toEqual(["消息2", "消息3"]);
  });

  it("limits page sizes and exposes no message mutation operation", async () => {
    await expect(service.after(null, 0)).rejects.toMatchObject({ code: "PAGE_SIZE_INVALID" });
    await expect(service.before(null, 51)).rejects.toMatchObject({ code: "PAGE_SIZE_INVALID" });

    expect("delete" in messages).toBe(false);
    expect("update" in messages).toBe(false);
    expect("clear" in messages).toBe(false);
  });

  it("accepts and stores image messages with metadata", async () => {
    const image = await service.send("1001", "img-1", "", undefined, {
      imageFileId: "cloud://env-bucket/chat-images/1001_img-1.jpg",
      imageMimeType: "image/jpeg",
      imageWidth: 800,
      imageHeight: 600
    });
    expect(image).toMatchObject({
      id: "1001_img-1",
      type: "image",
      imageFileId: "cloud://env-bucket/chat-images/1001_img-1.jpg",
      imageMimeType: "image/jpeg",
      imageWidth: 800,
      imageHeight: 600,
      body: ""
    });
  });

  it("accepts captioned image messages and rejects bad mime or a foreign file id", async () => {
    const captioned = await service.send("1001", "img-2", "@问理 看看这张图", undefined, {
      imageFileId: "cloud://env-bucket/chat-images/1001_img-2.jpg",
      imageMimeType: "image/jpeg"
    });
    expect(captioned).toMatchObject({
      id: "1001_img-2",
      type: "image",
      body: "@问理 看看这张图",
      imageFileId: "cloud://env-bucket/chat-images/1001_img-2.jpg",
      imageMimeType: "image/jpeg"
    });

    await expect(service.send("1001", "img-3", "", undefined, {
      imageFileId: "cloud://env-bucket/chat-images/1001_img-3.jpg",
      imageMimeType: "image/gif" as ImageMimeType
    })).rejects.toMatchObject({ code: "IMAGE_INVALID" });

    await expect(service.send("1001", "img-4", "", undefined, {
      imageFileId: "cloud://env-bucket/chat-images/1002_img-4.jpg",
      imageMimeType: "image/jpeg"
    })).rejects.toMatchObject({ code: "IMAGE_INVALID" });
  });

  it("rejects an image caption longer than 2000 characters", async () => {
    await expect(service.send("1001", "img-6", "@问理 " + "喵".repeat(2000), undefined, {
      imageFileId: "cloud://env-bucket/chat-images/1001_img-6.jpg",
      imageMimeType: "image/jpeg"
    })).rejects.toMatchObject({ code: "IMAGE_INVALID" });
  });

  it("requires image width and height together", async () => {
    await expect(service.send("1001", "img-5", "", undefined, {
      imageFileId: "cloud://env-bucket/chat-images/1001_img-5.jpg",
      imageMimeType: "image/jpeg",
      imageWidth: 800
    })).rejects.toMatchObject({ code: "IMAGE_INVALID" });
  });
});
