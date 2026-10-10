import { describe, expect, it, vi } from "vitest";
import {
  CloudBaseAvatarStore,
  CloudBaseLoginAttemptStore,
  CloudBaseMessageStore,
  CloudBaseReadStateStore,
  CloudBaseMomentStore,
  CloudBasePetSessionStore,
  CloudBaseRelationshipStore,
  CloudBaseUserStore,
  type CloudPersistence,
  type DocumentData
} from "../src/adapters/cloudbase-stores.js";
import { CloudBaseWenliAgentJobStore } from "../src/adapters/wenli-agent-job-stores.js";
import { CloudBaseWenliMemoryStore } from "../src/adapters/wenli-memory-stores.js";
import {
  INITIAL_PROFILES,
  type MessageCursor,
  type MessageRecord,
  type MomentCommentRecord,
  type MomentLikeRecord,
  type MomentRecord,
  type UserRecord
} from "../src/domain/contracts.js";
import type { WenliAgentJob } from "../src/domain/wenli-agent.js";
import type { WenliMemoryRecord } from "../src/domain/wenli-memory.js";
import type { LoginFailurePolicy } from "../src/ports/stores.js";
import { MomentService } from "../src/services/moment-service.js";
import { WenliTriggerService } from "../src/services/wenli-trigger-service.js";
import { ChatService } from "../src/services/chat-service.js";
import { WenliPendingMentionInvalidError } from "../src/ports/wenli-mention-outbox.js";

describe("CloudBase stores", () => {
  it("rejects a stale legacy read patch in the fallback adapter without changing stored fields", async () => {
    const cloud = new FakeCloudPersistence();
    const states = new CloudBaseReadStateStore(cloud);
    await states.save({
      accountId: "1001",
      lastReadMessageId: "1002_b",
      lastReadMessageCreatedAt: "2026-08-09T00:00:02.000Z",
      readReceiptMessageId: "1002_b",
      readReceiptMessageCreatedAt: "2026-08-09T00:00:02.000Z",
      updatedAt: "old"
    });

    await expect(states.patchLegacyReadState("1001", {
      lastReadMessageId: "1002_a",
      lastReadMessageCreatedAt: "2026-08-09T00:00:02.000Z"
    }, "new")).rejects.toMatchObject({ code: "READ_STATE_BEHIND" });
    expect(await states.get("1001")).toMatchObject({ lastReadMessageId: "1002_b", updatedAt: "old" });
  });

  it("captures a mention atomically while projecting out internal metadata from every public message read", async () => {
    const cloud = new FakeCloudPersistence();
    const messages = new CloudBaseMessageStore(cloud);
    const source: MessageRecord = { id: "1001_outbox", relationshipId: "couple", senderId: "1001", recipientId: "1002", clientMessageId: "outbox", body: "@小Q 在吗", createdAt: "2026-08-31T00:00:00.000Z" };
    const put = vi.spyOn(cloud, "putIfAbsent");
    const appended = await messages.appendIfAbsent({ ...source, wenliMentionPending: false } as MessageRecord, { captureWenliMention: true });
    expect(put).toHaveBeenCalledExactlyOnceWith("messages", source.id, { ...source, wenliMentionPending: true });
    vi.spyOn(cloud, "queryMessages").mockResolvedValue([{ ...source, wenliMentionPending: true }]);
    for (const publicMessage of [appended, await messages.get(source.id), ...(await messages.after(null, 50)), ...(await messages.before(null, 50)), await messages.getPendingMention(source.id)]) {
      expect(publicMessage).toEqual(source);
      expect(publicMessage).not.toHaveProperty("wenliMentionPending");
    }
    expect(await messages.pendingMentionIds(null, 50)).toEqual([source.id]);
    await messages.acknowledgeMention(source.id);
    await messages.acknowledgeMention(source.id);
    await messages.acknowledgeMention("missing");
    expect(await cloud.getDocument("messages", source.id)).toEqual({ ...source, wenliMentionPending: false });
    expect(await messages.getPendingMention(source.id)).toBeNull();
    await messages.appendIfAbsent({ ...source, body: "@小Q different" }, { captureWenliMention: true });
    expect(await messages.getPendingMention(source.id)).toBeNull();
    expect(await messages.get(source.id)).toEqual(source);
  });

  it("does not persist forged metadata or arm disabled-era duplicate mentions", async () => {
    const cloud = new FakeCloudPersistence();
    const messages = new CloudBaseMessageStore(cloud);
    const source: MessageRecord = { id: "1001_disabled", relationshipId: "couple", senderId: "1001", recipientId: "1002", clientMessageId: "disabled", body: "@小Q 在吗", createdAt: "2026-08-31T00:00:00.000Z" };
    await messages.appendIfAbsent({ ...source, wenliMentionPending: true } as MessageRecord);
    expect(await cloud.getDocument("messages", source.id)).toEqual(source);
    await messages.appendIfAbsent(source, { captureWenliMention: true });
    expect(await messages.getPendingMention(source.id)).toBeNull();
    expect(await cloud.getDocument("messages", source.id)).toEqual(source);
  });

  it("recovers accepted CloudBase mentions after enqueue failure without rewriting source fields", async () => {
    const cloud = new FakeCloudPersistence();
    const messages = new CloudBaseMessageStore(cloud);
    const jobs = new CloudBaseWenliAgentJobStore(cloud);
    const clock = () => new Date("2026-08-31T00:00:00.000Z");
    vi.spyOn(jobs, "createIfAbsent").mockRejectedValueOnce(new Error("temporary"));
    const source = await new ChatService(messages, clock, new WenliTriggerService(jobs, messages, clock)).send("1001", "recover", "@小Q 在吗");
    expect(await messages.getPendingMention(source.id)).toEqual(source);
    const restartedMessages = new CloudBaseMessageStore(cloud);
    const restarted = new WenliTriggerService(new CloudBaseWenliAgentJobStore(cloud), restartedMessages, clock);
    expect(await restarted.reconcilePending(null, 50)).toEqual({ scanned: 1, recovered: 1, failed: 0, nextCursor: source.id });
    expect(await cloud.getDocument("messages", source.id)).toEqual({ ...source, wenliMentionPending: false });
  });

  it.each([
    { id: "wrong" }, { body: "ordinary" }, { body: 7 }, { senderId: "unknown" }, { type: "image", body: "普通图片" }
  ])("classifies malformed marked sources as permanent and still handles the healthy ID: %j", async (overrides) => {
    const cloud = new FakeCloudPersistence();
    const base = { id: "1001_a", relationshipId: "couple", senderId: "1001", recipientId: "1002", clientMessageId: "a", body: "@小Q 在吗", createdAt: "2026-08-31T00:00:00.000Z", wenliMentionPending: true };
    await cloud.putDocument("messages", "1001_a", { ...base, ...overrides });
    await cloud.putDocument("messages", "1001_b", { ...base, id: "1001_b", clientMessageId: "b" });
    const messages = new CloudBaseMessageStore(cloud);
    await expect(messages.getPendingMention("1001_a")).rejects.toBeInstanceOf(WenliPendingMentionInvalidError);
    const trigger = new WenliTriggerService(new CloudBaseWenliAgentJobStore(cloud), messages);
    expect(await trigger.reconcilePending(null, 50)).toEqual({ scanned: 2, recovered: 1, failed: 1, nextCursor: "1001_b" });
    expect(await cloud.getDocument("messages", "1001_a")).toMatchObject({
      wenliMentionPending: false,
      body: overrides.body ?? base.body
    });
  });

  it("keeps a pending marker retryable across temporary source reads and unknown trigger errors", async () => {
    const cloud = new FakeCloudPersistence();
    const base = {
      id: "1001_retry",
      relationshipId: "couple",
      senderId: "1001",
      recipientId: "1002",
      clientMessageId: "retry",
      body: "@小Q 稍后",
      createdAt: "2026-08-31T00:00:00.000Z",
      wenliMentionPending: true
    };
    await cloud.putDocument("messages", base.id, base);
    const messages = new CloudBaseMessageStore(cloud);
    const temporaryRead = new Error("temporary source read");
    vi.spyOn(cloud, "getDocument").mockRejectedValueOnce(temporaryRead);
    await expect(messages.getPendingMention(base.id)).rejects.toBe(temporaryRead);

    const pendingRead = vi.spyOn(messages, "getPendingMention").mockRejectedValueOnce(temporaryRead);
    const acknowledge = vi.spyOn(messages, "acknowledgeMention");
    const trigger = new WenliTriggerService(new CloudBaseWenliAgentJobStore(cloud), messages);
    await expect(trigger.reconcilePending(null, 50)).resolves.toEqual({
      scanned: 1, recovered: 0, failed: 1, nextCursor: base.id
    });
    expect(pendingRead).toHaveBeenCalledWith(base.id);
    expect(acknowledge).not.toHaveBeenCalled();
    expect(await cloud.getDocument("messages", base.id)).toMatchObject({
      wenliMentionPending: true,
      body: base.body
    });

    await expect(trigger.reconcilePending(null, 50)).resolves.toMatchObject({ recovered: 1, failed: 0 });
    expect(acknowledge).toHaveBeenCalledWith(base.id);
    expect(await cloud.getDocument("messages", base.id)).toMatchObject({
      wenliMentionPending: false,
      body: base.body
    });
  });

  it("round-trips desktop pet session expiry and safely expires legacy records", async () => {
    const cloud = new FakeCloudPersistence();
    const sessions = new CloudBasePetSessionStore(cloud);
    const current = {
      id: "1001" as const,
      accountId: "1001" as const,
      sessionHash: "pet-session-hash",
      expiresAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z"
    };

    await sessions.save(current);
    await expect(sessions.findBySessionHash("pet-session-hash")).resolves.toEqual(current);

    await cloud.putDocument("petSessions", "1002", {
      id: "1002",
      accountId: "1002",
      sessionHash: "legacy-pet-session",
      updatedAt: "2026-08-06T00:00:00.000Z"
    });
    await expect(sessions.get("1002")).resolves.toMatchObject({ expiresAt: "1970-01-01T00:00:00.000Z" });
  });

  it("uses fixed document ids for users and keeps secrets server-side", async () => {
    const cloud = new FakeCloudPersistence();
    const users = new CloudBaseUserStore(cloud);
    const record = user("1001");

    await users.save(record);

    expect(cloud.documentIds("users")).toEqual(["1001"]);
    await expect(users.get("1001")).resolves.toEqual(record);
    await expect(users.findBySessionHash("session-hash")).resolves.toEqual(record);
  });

  it("restores users atomically and reports whether the document was inserted", async () => {
    const cloud = new FakeCloudPersistence();
    const users = new CloudBaseUserStore(cloud);
    const original = user("1001", { displayName: "original" });
    const replacement = user("1001", { displayName: "replacement" });

    await expect(users.restoreIfAbsent(original)).resolves.toEqual({ user: original, inserted: true });
    await expect(users.restoreIfAbsent(replacement)).resolves.toEqual({ user: original, inserted: false });
    await expect(users.get("1001")).resolves.toEqual(original);
  });

  it("reads legacy user documents with account-specific profile defaults", async () => {
    const cloud = new FakeCloudPersistence();
    const users = new CloudBaseUserStore(cloud);
    const legacy1001 = user("1001") as unknown as DocumentData;
    delete legacy1001.gender;
    delete legacy1001.profileInitializedVersion;
    const legacy1002 = user("1002") as unknown as DocumentData;
    legacy1002.gender = "invalid";
    legacy1002.profileInitializedVersion = 2;
    await cloud.putDocument("users", "1001", legacy1001);
    await cloud.putDocument("users", "1002", legacy1002);

    await expect(users.get("1001")).resolves.toMatchObject({ gender: "女", profileInitializedVersion: 0 });
    await expect(users.get("1002")).resolves.toMatchObject({ gender: "男", profileInitializedVersion: 2 });
  });

  it("initializes both profiles once without replacing current password or session fields", async () => {
    const cloud = new FakeCloudPersistence();
    const users = new CloudBaseUserStore(cloud);
    await users.save(user("1001", {
      passwordHash: "latest-password-hash",
      sessionHash: "latest-session-hash",
      sessionVersion: 9
    }));
    await users.save(user("1002"));
    const fields = initialFields();

    await expect(users.initializeProfilesIfNeeded(fields)).resolves.toMatchObject({
      initializedAccounts: ["1001", "1002"]
    });
    await expect(users.initializeProfilesIfNeeded(fields)).resolves.toMatchObject({ initializedAccounts: [] });
    await expect(users.get("1001")).resolves.toMatchObject({
      ...fields["1001"],
      profileInitializedVersion: 1,
      passwordHash: "latest-password-hash",
      sessionHash: "latest-session-hash",
      sessionVersion: 9
    });
  });

  it("uses scoped patches without replacing initialized profile fields", async () => {
    const cloud = new FakeCloudPersistence();
    const users = new CloudBaseUserStore(cloud);
    await users.save(user("1001"));
    await users.save(user("1002"));
    await users.initializeProfilesIfNeeded(initialFields());

    await users.rotateSession("1001", { sessionHash: "new", updatedAt: "session" });
    await users.updateDisplayName("1001", "chosen", "profile");
    await users.updateAvatar("1001", "current-avatar", "avatar");

    await expect(users.get("1001")).resolves.toMatchObject({
      displayName: "chosen",
      avatarKey: "current-avatar",
      profileInitializedVersion: 1,
      sessionHash: "new"
    });
  });

  it("hashes login-attempt document ids so network source values are not collection keys", async () => {
    const cloud = new FakeCloudPersistence();
    const attempts = new CloudBaseLoginAttemptStore(cloud);

    await attempts.save("1001", "203.0.113.9", { failures: 2, blockedUntil: null });

    const [id] = cloud.documentIds("login_attempts");
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(id).not.toContain("203.0.113.9");
    await expect(attempts.get("1001", "203.0.113.9")).resolves.toEqual({ failures: 2, blockedUntil: null });
    await attempts.clear("1001", "203.0.113.9");
    await expect(attempts.get("1001", "203.0.113.9")).resolves.toBeNull();
  });

  it("creates a message once and never overwrites it on retry", async () => {
    const cloud = new FakeCloudPersistence();
    const messages = new CloudBaseMessageStore(cloud);
    const original = message("1001_m-1", "第一条");

    await expect(messages.appendIfAbsent(original)).resolves.toEqual(original);
    await expect(messages.appendIfAbsent({ ...original, body: "不能覆盖" })).resolves.toEqual(original);
    await expect(messages.count()).resolves.toBe(1);
    expect("delete" in messages).toBe(false);
    expect("update" in messages).toBe(false);
  });

  it("round-trips a traceable Wenli reply without treating Wenli as an account", async () => {
    const cloud = new FakeCloudPersistence();
    const messages = new CloudBaseMessageStore(cloud);
    const reply: MessageRecord = {
      id: "wenli_reply_7ac01f",
      relationshipId: "couple",
      senderId: "wenli",
      recipientId: "1002",
      clientMessageId: "reply_7ac01f",
      body: "我在呢。",
      replyToMessageId: "1001_source-1",
      sourceMessageId: "1001_source-1",
      createdAt: "2026-08-30T00:00:00.000Z"
    };

    await expect(messages.appendIfAbsent(reply)).resolves.toEqual(reply);
    await expect(messages.get(reply.id)).resolves.toEqual(reply);
  });

  it("rejects an unknown message sender from CloudBase", async () => {
    const cloud = new FakeCloudPersistence();
    await cloud.putDocument("messages", "robot_bad", {
      id: "robot_bad",
      relationshipId: "couple",
      senderId: "robot",
      recipientId: "1002",
      clientMessageId: "bad",
      body: "bad",
      createdAt: "2026-08-30T00:00:00.000Z"
    });

    await expect(new CloudBaseMessageStore(cloud).get("robot_bad"))
      .rejects.toThrow("Invalid message sender");
  });

  it("rejects a Wenli document without an exact human source trace", async () => {
    const cloud = new FakeCloudPersistence();
    await cloud.putDocument("messages", "wenli_bad", {
      id: "wenli_bad",
      relationshipId: "couple",
      senderId: "wenli",
      recipientId: "1002",
      clientMessageId: "bad",
      body: "bad",
      replyToMessageId: "1001_source-1",
      createdAt: "2026-08-30T00:00:00.000Z"
    });

    await expect(new CloudBaseMessageStore(cloud).get("wenli_bad"))
      .rejects.toThrow("invalid message document");
  });

  it.each(["wenli_reply_other", "not-a-human-message-id"])(
    "rejects a Wenli document whose source is not a canonical human message: %s",
    async (sourceMessageId) => {
      const cloud = new FakeCloudPersistence();
      await cloud.putDocument("messages", "wenli_bad-source", {
        id: "wenli_bad-source",
        relationshipId: "couple",
        senderId: "wenli",
        recipientId: "1002",
        clientMessageId: "bad-source",
        body: "bad",
        replyToMessageId: sourceMessageId,
        sourceMessageId,
        createdAt: "2026-08-30T00:00:00.000Z"
      });

      await expect(new CloudBaseMessageStore(cloud).get("wenli_bad-source"))
        .rejects.toThrow("invalid message document");
    }
  );

  it("rejects image payloads authored by Wenli", async () => {
    const cloud = new FakeCloudPersistence();
    await cloud.putDocument("messages", "wenli_image", {
      id: "wenli_image",
      relationshipId: "couple",
      senderId: "wenli",
      recipientId: "1002",
      clientMessageId: "image",
      body: "",
      replyToMessageId: "1001_source-1",
      sourceMessageId: "1001_source-1",
      type: "image",
      imageFileId: "cloud://env-bucket/chat-images/wenli_image.jpg",
      imageMimeType: "image/jpeg",
      createdAt: "2026-08-30T00:00:00.000Z"
    });

    await expect(new CloudBaseMessageStore(cloud).get("wenli_image"))
      .rejects.toThrow("invalid message document");
  });

  it("rejects stray Wenli image metadata even when the type field is omitted", async () => {
    const cloud = new FakeCloudPersistence();
    await cloud.putDocument("messages", "wenli_stray-image", {
      id: "wenli_stray-image",
      relationshipId: "couple",
      senderId: "wenli",
      recipientId: "1002",
      clientMessageId: "stray-image",
      body: "仍然是文字",
      replyToMessageId: "1001_source-1",
      sourceMessageId: "1001_source-1",
      imageFileId: "cloud://env-bucket/chat-images/wenli_stray-image.jpg",
      imageMimeType: "image/jpeg",
      createdAt: "2026-08-30T00:00:00.000Z"
    });

    await expect(new CloudBaseMessageStore(cloud).get("wenli_stray-image"))
      .rejects.toThrow("invalid message document");
  });

  it("creates a Wenli agent job once and strictly parses stored jobs", async () => {
    const cloud = new FakeCloudPersistence();
    const jobs = new CloudBaseWenliAgentJobStore(cloud);
    const pending: WenliAgentJob = {
      id: "1001_source-1",
      type: "mention",
      requesterId: "1001",
      sourceMessageId: "1001_source-1",
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: "2026-08-30T00:00:00.000Z",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z"
    };

    await expect(jobs.createIfAbsent(pending)).resolves.toEqual(pending);
    await expect(jobs.createIfAbsent({ ...pending, requesterId: "1002" })).resolves.toEqual(pending);
    await expect(jobs.get(pending.id)).resolves.toEqual(pending);

    await cloud.putDocument("wenliAgentJobs", "bad-job", { ...pending, id: "bad-job", requesterId: "robot" });
    await expect(jobs.get("bad-job")).rejects.toThrow("Invalid Wenli agent job");
  });

  it("creates Wenli memory once and rejects corrupt stored records", async () => {
    const cloud = new FakeCloudPersistence();
    const memories = new CloudBaseWenliMemoryStore(cloud);
    const original = memory("mem_20260901_1");

    await expect(memories.append(original)).resolves.toEqual(original);
    await expect(memories.append({ ...original, summary: "不能覆盖", salience: 100 })).resolves.toEqual(original);
    await expect(memories.listForContext(10)).resolves.toEqual([original]);

    await cloud.putDocument("wenliMemories", "mem_corrupt", {
      ...memory("mem_corrupt"),
      createdAt: "today"
    });
    await expect(memories.listForContext(10)).rejects.toThrow("Invalid Wenli memory record");
  });

  it.each([
    { name: "mismatching id", id: "mem_payload" },
    { name: "wrong-type id", id: 7 }
  ])("rejects Wenli memory list records with explicit corrupted stored identity: $name", async ({ id }) => {
    const cloud = new FakeCloudPersistence();
    const memories = new CloudBaseWenliMemoryStore(cloud);
    await cloud.putDocument("wenliMemories", "mem_canonical", {
      ...memory("mem_canonical"),
      id
    });

    await expect(memories.listForContext(10)).rejects.toThrow("Invalid Wenli memory record");
  });

  it("uses the Wenli memory document key as canonical id when stored data has no id", async () => {
    const cloud = new FakeCloudPersistence();
    const memories = new CloudBaseWenliMemoryStore(cloud);
    const { id: _missing, ...document } = memory("mem_canonical");
    await cloud.putDocument("wenliMemories", "mem_canonical", document);

    await expect(memories.listForContext(10)).resolves.toEqual([
      memory("mem_canonical")
    ]);
  });

  it.each([
    { name: "mismatching id", id: "mem_payload" },
    { name: "wrong-type id", id: 7 }
  ])("rejects Wenli memory append when stored identity is explicit and corrupt: $name", async ({ id }) => {
    const cloud = new FakeCloudPersistence();
    const memories = new CloudBaseWenliMemoryStore(cloud);
    await cloud.putDocument("wenliMemories", "mem_canonical", {
      ...memory("mem_canonical"),
      id
    });

    await expect(memories.append(memory("mem_canonical"))).rejects.toThrow("Invalid Wenli memory record");
  });

  it("uses the appended Wenli memory key when an existing stored document has no id", async () => {
    const cloud = new FakeCloudPersistence();
    const memories = new CloudBaseWenliMemoryStore(cloud);
    const { id: _missing, ...document } = memory("mem_canonical");
    await cloud.putDocument("wenliMemories", "mem_canonical", document);

    await expect(memories.append(memory("mem_canonical"))).resolves.toEqual(memory("mem_canonical"));
  });

  it("lists recent active Wenli memories through the bounded CloudBase memory query", async () => {
    const cloud = new FakeCloudPersistence();
    const memories = new CloudBaseWenliMemoryStore(cloud);

    for (let index = 0; index < 205; index += 1) {
      const id = `mem_a_${String(index).padStart(3, "0")}`;
      await cloud.putDocument("wenliMemories", id, { ...memory(id, {
        status: "retracted",
        updatedAt: "2026-09-01T00:00:00.000Z"
      }) });
    }
    await cloud.putDocument("wenliMemories", "mem_z_recent_1", { ...memory("mem_z_recent_1", {
      summary: "最新事实 1",
      updatedAt: "2026-09-03T00:00:00.000Z"
    }) });
    await cloud.putDocument("wenliMemories", "mem_z_recent_2", { ...memory("mem_z_recent_2", {
      summary: "最新事实 2",
      updatedAt: "2026-09-03T00:00:00.000Z"
    }) });
    await cloud.putDocument("wenliMemories", "mem_z_older", { ...memory("mem_z_older", {
      summary: "较早事实",
      updatedAt: "2026-09-02T00:00:00.000Z"
    }) });

    await expect(memories.listForContext(2)).resolves.toEqual([
      memory("mem_z_recent_2", { summary: "最新事实 2", updatedAt: "2026-09-03T00:00:00.000Z" }),
      memory("mem_z_recent_1", { summary: "最新事实 1", updatedAt: "2026-09-03T00:00:00.000Z" })
    ]);
    expect(cloud.wenliMemoryQueries).toEqual([{ limit: 200 }]);
    expect(cloud.scanQueries).not.toContainEqual({ collection: "wenliMemories", afterId: null, limit: 200 });
  });

  it("creates a deterministic moment once and strictly maps stored moment documents", async () => {
    const cloud = new FakeCloudPersistence();
    const moments = new CloudBaseMomentStore(cloud);
    const original = moment("1001_m-1");

    await expect(moments.appendMomentIfAbsent(original)).resolves.toEqual(original);
    await expect(moments.appendMomentIfAbsent({ ...original, body: "replacement" })).resolves.toEqual(original);
    expect(cloud.documentIds("moments")).toEqual([original.id]);
    await expect(cloud.getDocument("moments", original.id)).resolves.toEqual({
      ...original,
      interactionVersion: 0
    });

    const malformed: DocumentData[] = [
      { ...original, authorId: "0000" },
      { ...original, visibility: "PUBLIC" },
      { ...original, createdAt: "August 7, 2026" },
      { ...original, deleting: 0 },
      { ...original, id: "1002_m-1" },
      { ...original, clientMomentId: "bad/id" },
      { ...original, interactionVersion: -1 },
      { ...original, interactionVersion: 1.5 },
      { ...original, interactionVersion: Number.POSITIVE_INFINITY }
    ];
    for (const [index, document] of malformed.entries()) {
      await cloud.putDocument("moments", `malformed-${index}`, document);
      await expect(moments.getMoment(`malformed-${index}`)).rejects.toThrow();
    }

    const legacy = moment("1002_legacy", {
      authorId: "1002",
      clientMomentId: "legacy"
    });
    await cloud.putDocument("moments", legacy.id, { ...legacy });
    await expect(moments.getMoment(legacy.id)).resolves.toEqual(legacy);
  });

  it("loads viewer-aware moments and scopes deletion operations to the target record", async () => {
    const cloud = new FakeCloudPersistence();
    const moments = new CloudBaseMomentStore(cloud);
    const shared = moment("1001_shared", { clientMomentId: "shared", visibility: "PARTNER" });
    const hidden = moment("1001_hidden", {
      clientMomentId: "hidden",
      visibility: "SELF",
      createdAt: "2026-08-07T00:00:01.000Z"
    });
    await cloud.putDocument("moments", shared.id, { ...shared });
    await cloud.putDocument("moments", hidden.id, { ...hidden });

    await expect(moments.latestVisibleMoments("1002", 1)).resolves.toEqual([shared]);
    expect(cloud.latestMomentQueries).toEqual([{ viewerId: "1002", limit: 1 }]);

    await moments.markDeleting(shared.id);
    await expect(moments.getMoment(shared.id)).resolves.toEqual({ ...shared, deleting: true });
    await expect(moments.markDeleting("missing")).resolves.toBeUndefined();

    await moments.removeMoment(shared.id);
    await expect(moments.getMoment(shared.id)).resolves.toBeNull();
    await expect(moments.getMoment(hidden.id)).resolves.toEqual(hidden);
  });

  it("strictly maps and stably sorts batched likes and comments", async () => {
    const cloud = new FakeCloudPersistence();
    const moments = new CloudBaseMomentStore(cloud);
    const firstMomentId = "1001_m-1";
    const secondMomentId = "1002_m-2";
    const laterLike = like(secondMomentId, "1002", "2026-08-07T00:00:01.000Z");
    const firstLike = like(firstMomentId, "1001", "2026-08-07T00:00:00.000Z");
    const sameTimeLaterId = like(firstMomentId, "1002", "2026-08-07T00:00:00.000Z");
    const laterComment = comment(secondMomentId, "1002", "second", "2026-08-07T00:00:01.000Z");
    const firstComment = comment(firstMomentId, "1001", "first", "2026-08-07T00:00:00.000Z");
    for (const record of [laterLike, firstLike, sameTimeLaterId]) {
      await cloud.putDocument("momentLikes", record.id, { ...record });
    }
    for (const record of [laterComment, firstComment]) {
      await cloud.putDocument("momentComments", record.id, { ...record });
    }

    await expect(moments.likesFor([secondMomentId, firstMomentId])).resolves.toEqual([
      firstLike,
      sameTimeLaterId,
      laterLike
    ]);
    await expect(moments.commentsFor([secondMomentId, firstMomentId])).resolves.toEqual([
      firstComment,
      laterComment
    ]);
    expect(cloud.relationQueries).toEqual([
      { collection: "momentLikes", momentIds: [secondMomentId, firstMomentId] },
      { collection: "momentComments", momentIds: [secondMomentId, firstMomentId] }
    ]);

    const malformedLikes: DocumentData[] = [
      { ...firstLike, accountId: "0000" },
      { ...firstLike, createdAt: "today" },
      { ...firstLike, id: `${firstMomentId}_1002` },
      { ...firstLike, momentId: "malformed" }
    ];
    for (const [index, record] of malformedLikes.entries()) {
      const id = `bad-like-${index}`;
      await cloud.putDocument("momentLikes", id, record);
      await expect(moments.likesFor([String(record.momentId)])).rejects.toThrow();
      await cloud.removeDocument("momentLikes", id);
    }

    const malformedComments: DocumentData[] = [
      { ...firstComment, authorId: "0000" },
      { ...firstComment, clientCommentId: "bad/id" },
      { ...firstComment, createdAt: "today" },
      { ...firstComment, id: "1002_first" },
      { ...firstComment, momentId: "malformed" }
    ];
    for (const [index, record] of malformedComments.entries()) {
      const id = `bad-comment-${index}`;
      await cloud.putDocument("momentComments", id, record);
      await expect(moments.commentsFor([String(record.momentId)])).rejects.toThrow();
      await cloud.removeDocument("momentComments", id);
    }
  });

  it("uses atomic conditional interaction appends and exact relation removals", async () => {
    const cloud = new FakeCloudPersistence();
    const moments = new CloudBaseMomentStore(cloud);
    const post = moment("1001_m-1");
    const originalLike = like(post.id, "1002", "2026-08-07T00:00:00.000Z");
    const originalComment = comment(post.id, "1002", "comment-1", "2026-08-07T00:00:00.000Z");
    await cloud.putDocument("moments", post.id, { ...post });

    await expect(moments.appendLikeToVisibleMomentIfAbsent(originalLike)).resolves.toEqual(originalLike);
    await expect(moments.appendLikeToVisibleMomentIfAbsent({
      ...originalLike,
      createdAt: "2026-08-07T00:00:01.000Z"
    })).resolves.toEqual(originalLike);
    await expect(moments.appendCommentToVisibleMomentIfAbsent(originalComment)).resolves.toEqual(originalComment);
    await expect(moments.getComment(originalComment.id)).resolves.toEqual(originalComment);

    await moments.removeLike(originalLike.id);
    await moments.removeComment(originalComment.id);
    await expect(moments.likesFor([post.id])).resolves.toEqual([]);
    await expect(moments.getComment(originalComment.id)).resolves.toBeNull();

    await moments.appendLikeToVisibleMomentIfAbsent(originalLike);
    await moments.appendCommentToVisibleMomentIfAbsent(originalComment);
    await moments.removeRelations(post.id);
    await expect(moments.likesFor([post.id])).resolves.toEqual([]);
    await expect(moments.commentsFor([post.id])).resolves.toEqual([]);
  });

  it("keeps the CloudBase deletion marker when relation cleanup fails so service retry can finish", async () => {
    const cloud = new FakeCloudPersistence();
    const moments = new CloudBaseMomentStore(cloud);
    const service = new MomentService(moments, () => new Date("2026-08-07T00:00:00.000Z"));
    const post = await service.create("1001", "cleanup-retry", "post", "PARTNER");
    cloud.relationRemovalError = new Error("resolved CloudBase cleanup error");

    await expect(service.delete("1001", post.id)).rejects.toThrow("resolved CloudBase cleanup error");
    await expect(moments.getMoment(post.id)).resolves.toMatchObject({ deleting: true });

    cloud.relationRemovalError = null;
    await expect(service.delete("1001", post.id)).resolves.toEqual({ deleted: true });
    await expect(moments.getMoment(post.id)).resolves.toBeNull();
  });

  it("keeps the CloudBase deletion marker when final post removal fails so service retry can finish", async () => {
    const cloud = new FakeCloudPersistence();
    const moments = new CloudBaseMomentStore(cloud);
    const service = new MomentService(moments, () => new Date("2026-08-07T00:00:00.000Z"));
    const post = await service.create("1001", "remove-retry", "post", "PARTNER");
    cloud.documentRemovalError = {
      collection: "moments",
      id: post.id,
      error: new Error("resolved CloudBase post remove error")
    };

    await expect(service.delete("1001", post.id)).rejects.toThrow("resolved CloudBase post remove error");
    await expect(moments.getMoment(post.id)).resolves.toMatchObject({ deleting: true });

    cloud.documentRemovalError = null;
    await expect(service.delete("1001", post.id)).resolves.toEqual({ deleted: true });
    await expect(moments.getMoment(post.id)).resolves.toBeNull();
  });

  it("delegates ordered cursor queries and avatar uploads to CloudBase", async () => {
    const cloud = new FakeCloudPersistence();
    const messages = new CloudBaseMessageStore(cloud);
    const avatars = new CloudBaseAvatarStore(cloud);
    const cursor: MessageCursor = { createdAt: "2026-08-06T00:00:00.000Z", id: "1001_m-1" };

    await messages.after(cursor, 25);
    await messages.before(cursor, 10);
    await avatars.put("avatars/1001/hash.png", { contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) });

    expect(cloud.queries).toEqual([
      { direction: "after", cursor, limit: 25 },
      { direction: "before", cursor, limit: 10 }
    ]);
    expect(cloud.uploads).toEqual([{ key: "avatars/1001/hash.png", bytes: new Uint8Array([1, 2, 3]) }]);
  });

  it("creates the fixed relationship without replacing it", async () => {
    const cloud = new FakeCloudPersistence();
    const relationships = new CloudBaseRelationshipStore(cloud);
    const original = { id: "couple" as const, memberIds: ["1001", "1002"] as ["1001", "1002"], createdAt: "first" };

    await expect(relationships.createIfAbsent(original)).resolves.toMatchObject({ created: true, record: original });
    await expect(relationships.createIfAbsent({ ...original, createdAt: "replacement" }))
      .resolves.toMatchObject({ created: false, record: original });
    await expect(relationships.count()).resolves.toBe(1);
  });
});

class FakeCloudPersistence implements CloudPersistence {
  readonly queries: Array<{ direction: "after" | "before"; cursor: MessageCursor | null; limit: number }> = [];
  readonly latestMomentQueries: Array<{ viewerId: "1001" | "1002"; limit: number }> = [];
  readonly wenliMemoryQueries: Array<{ limit: number }> = [];
  readonly relationQueries: Array<{
    collection: "momentLikes" | "momentComments";
    momentIds: string[];
  }> = [];
  readonly scanQueries: Array<{ collection: string; afterId: string | null; limit: number }> = [];
  readonly uploads: Array<{ key: string; bytes: Uint8Array }> = [];
  relationRemovalError: Error | null = null;
  documentRemovalError: { collection: string; id: string; error: Error } | null = null;
  private readonly collections = new Map<string, Map<string, DocumentData>>();

  async getDocument(collection: string, id: string): Promise<DocumentData | null> {
    return structuredClone(this.collections.get(collection)?.get(id) ?? null);
  }

  async findOne(collection: string, equality: Record<string, unknown>): Promise<DocumentData | null> {
    const found = [...(this.collections.get(collection)?.values() ?? [])].find((document) =>
      Object.entries(equality).every(([key, value]) => document[key] === value)
    );
    return structuredClone(found ?? null);
  }

  async putDocument(collection: string, id: string, data: DocumentData): Promise<void> {
    this.collection(collection).set(id, structuredClone(data));
  }

  async recordLoginFailure(id: string, policy: LoginFailurePolicy) {
    const latest = this.collection("login_attempts").get(id);
    const now = Date.parse(policy.now);
    const blockedUntil = typeof latest?.blockedUntil === "string" ? latest.blockedUntil : null;
    if (blockedUntil && Date.parse(blockedUntil) > now) return { failures: Number(latest!.failures), blockedUntil };
    const failures = (blockedUntil ? 0 : Number(latest?.failures ?? 0)) + 1;
    const record = {
      failures,
      blockedUntil: failures >= policy.maxFailures ? new Date(now + policy.blockMilliseconds).toISOString() : null
    };
    this.collection("login_attempts").set(id, structuredClone(record));
    return record;
  }

  async removeDocument(collection: string, id: string): Promise<void> {
    if (this.documentRemovalError?.collection === collection && this.documentRemovalError.id === id) {
      throw this.documentRemovalError.error;
    }
    this.collection(collection).delete(id);
  }

  async putIfAbsent(collection: string, id: string, data: DocumentData): Promise<DocumentData> {
    return (await this.putIfAbsentWithStatus(collection, id, data)).document;
  }

  async putIfAbsentWithStatus(
    collection: string,
    id: string,
    data: DocumentData
  ): Promise<{ document: DocumentData; inserted: boolean }> {
    const existing = this.collection(collection).get(id);
    if (existing) return { document: structuredClone(existing), inserted: false };
    this.collection(collection).set(id, structuredClone(data));
    return { document: structuredClone(data), inserted: true };
  }

  async initializeUserProfilesIfNeeded(fields: ReturnType<typeof initialFields>) {
    const latest = [this.collection("users").get("1001"), this.collection("users").get("1002")];
    if (latest.some((document) => !document)) return { documents: null, initializedAccounts: [] };
    const initializedAccounts: Array<"1001" | "1002"> = [];
    const documents = (["1001", "1002"] as const).map((accountId, index) => {
      const document = latest[index]!;
      if (typeof document.profileInitializedVersion === "number" && document.profileInitializedVersion >= 1) {
        return document;
      }
      initializedAccounts.push(accountId);
      return { ...document, ...fields[accountId], profileInitializedVersion: 1 };
    });
    for (const document of documents) this.collection("users").set(String(document.accountId), structuredClone(document));
    return { documents: structuredClone(documents), initializedAccounts };
  }

  async patchUserDocument(
    accountId: "1001" | "1002",
    fields: DocumentData,
    incrementSessionVersion: boolean
  ): Promise<DocumentData | null> {
    const latest = this.collection("users").get(accountId);
    if (!latest) return null;
    const document = {
      ...latest,
      ...fields,
      ...(incrementSessionVersion ? { sessionVersion: Number(latest.sessionVersion) + 1 } : {})
    };
    this.collection("users").set(accountId, structuredClone(document));
    return structuredClone(document);
  }

  async queryMessages(
    direction: "after" | "before",
    cursor: MessageCursor | null,
    limit: number
  ): Promise<DocumentData[]> {
    this.queries.push({ direction, cursor: structuredClone(cursor), limit });
    return [];
  }

  async queryPendingWenliMentionIds(afterId: string | null, limit: number): Promise<string[]> {
    return [...this.collection("messages")]
      .filter(([id, data]) => data.wenliMentionPending === true && (afterId === null || id > afterId))
      .map(([id]) => id).sort().slice(0, limit);
  }

  async queryDueWenliAgentJobs(_now: string, _limit: number): Promise<DocumentData[]> {
    return [];
  }

  async acknowledgeWenliMention(id: string): Promise<void> {
    const latest = this.collection("messages").get(id);
    if (latest?.wenliMentionPending === true) this.collection("messages").set(id, { ...latest, wenliMentionPending: false });
  }

  async queryLatestVisibleMoments(viewerId: "1001" | "1002", limit: number): Promise<DocumentData[]> {
    this.latestMomentQueries.push({ viewerId, limit });
    return [...this.collection("moments").values()]
      .filter((document) =>
        document.deleting === false && (document.visibility === "PARTNER" || document.authorId === viewerId)
      )
      .sort((left, right) =>
        String(right.createdAt).localeCompare(String(left.createdAt)) || String(right.id).localeCompare(String(left.id))
      )
      .slice(0, limit)
      .map((document) => structuredClone(document));
  }

  async queryWenliMemories(limit: number) {
    this.wenliMemoryQueries.push({ limit });
    return [...this.collection("wenliMemories").entries()]
      .filter(([, document]) => document.status === "active")
      .sort(([leftId, left], [rightId, right]) =>
        String(right.updatedAt).localeCompare(String(left.updatedAt)) || rightId.localeCompare(leftId)
      )
      .slice(0, Math.min(limit, 200))
      .map(([id, data]) => ({ id, data: structuredClone(data) }));
  }

  async queryMomentRelations(
    collection: "momentLikes" | "momentComments",
    momentIds: string[]
  ): Promise<DocumentData[]> {
    this.relationQueries.push({ collection, momentIds: [...momentIds] });
    const requested = new Set(momentIds);
    return [...this.collection(collection).values()]
      .filter((document) => requested.has(String(document.momentId)))
      .map((document) => structuredClone(document));
  }

  async removeMomentRelations(momentId: string): Promise<void> {
    if (this.relationRemovalError) throw this.relationRemovalError;
    for (const collection of ["momentLikes", "momentComments"] as const) {
      for (const [id, document] of this.collection(collection)) {
        if (document.momentId === momentId) this.collection(collection).delete(id);
      }
    }
  }

  async appendMomentRelationIfVisible(
    collection: "momentLikes" | "momentComments",
    relationId: string,
    momentId: string,
    actorId: "1001" | "1002",
    data: DocumentData
  ): Promise<DocumentData | null> {
    const moment = this.collection("moments").get(momentId);
    if (!moment || moment.deleting !== false ||
      (moment.visibility !== "PARTNER" && !(moment.visibility === "SELF" && moment.authorId === actorId))) {
      return null;
    }
    const existing = this.collection(collection).get(relationId);
    if (existing) return structuredClone(existing);
    const interactionVersion = typeof moment.interactionVersion === "number" ? moment.interactionVersion : 0;
    this.collection("moments").set(momentId, { ...moment, interactionVersion: interactionVersion + 1 });
    this.collection(collection).set(relationId, structuredClone(data));
    return structuredClone(data);
  }

  async markMomentDeleting(momentId: string): Promise<void> {
    const existing = this.collection("moments").get(momentId);
    if (existing) this.collection("moments").set(momentId, { ...existing, deleting: true });
  }

  async countDocuments(collection: string): Promise<number> {
    return this.collection(collection).size;
  }

  async scanDocuments(collection: string, afterId: string | null, limit: number) {
    this.scanQueries.push({ collection, afterId, limit });
    return [...this.collection(collection).entries()]
      .filter(([id]) => afterId === null || id > afterId)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, limit)
      .map(([id, data]) => ({ id, data: structuredClone(data) }));
  }

  async upload(key: string, bytes: Uint8Array): Promise<string> {
    this.uploads.push({ key, bytes: structuredClone(bytes) });
    return key;
  }

  async temporaryUrl(storedKey: string): Promise<string> {
    return `https://example.invalid/${storedKey}`;
  }

  async uploadMetadata(cloudPath: string) {
    return {
      uploadUrl: `https://upload.example.invalid/${cloudPath}`,
      authorization: "fake-authorization",
      token: "fake-token",
      cosFileId: "fake-cos-file-id",
      fileId: `cloud://fake-bucket/${cloudPath}`
    };
  }

  async temporaryFileUrl(fileId: string): Promise<string> {
    return `https://example.invalid/${fileId}`;
  }

  async downloadFile(_fileId: string): Promise<Uint8Array> {
    throw new Error("not implemented in fake");
  }

  documentIds(collection: string): string[] {
    return [...this.collection(collection).keys()];
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

function user(accountId: "1001" | "1002", overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    accountId,
    ...INITIAL_PROFILES[accountId],
    avatarKey: null,
    profileInitializedVersion: 0,
    passwordHash: "password-hash",
    sessionHash: "session-hash",
    sessionVersion: 1,
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides
  };
}

function message(id: string, body: string): MessageRecord {
  return {
    id,
    relationshipId: "couple",
    senderId: "1001",
    recipientId: "1002",
    clientMessageId: "m-1",
    body,
    createdAt: "2026-08-06T00:00:00.000Z"
  };
}

function moment(id: string, overrides: Partial<MomentRecord> = {}): MomentRecord {
  return {
    id,
    authorId: "1001",
    clientMomentId: "m-1",
    body: "first post",
    visibility: "PARTNER",
    createdAt: "2026-08-07T00:00:00.000Z",
    deleting: false,
    ...overrides
  };
}

function like(momentId: string, accountId: "1001" | "1002", createdAt: string): MomentLikeRecord {
  return {
    id: `${momentId}_${accountId}`,
    momentId,
    accountId,
    createdAt
  };
}

function comment(
  momentId: string,
  authorId: "1001" | "1002",
  clientCommentId: string,
  createdAt: string
): MomentCommentRecord {
  return {
    id: `${authorId}_${clientCommentId}`,
    momentId,
    authorId,
    clientCommentId,
    body: "comment",
    createdAt
  };
}

function memory(id: string, overrides: Partial<WenliMemoryRecord> = {}): WenliMemoryRecord {
  return {
    id,
    kind: "fact",
    summary: "示例甲最近在学滑板",
    speakerIds: ["1001"],
    sourceEventIds: ["1001_ask-1"],
    salience: 50,
    status: "active",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

function initialFields() {
  return {
    "1001": { ...INITIAL_PROFILES["1001"], avatarKey: "avatars/1001/initial.jpg", updatedAt: "initialized" },
    "1002": { ...INITIAL_PROFILES["1002"], avatarKey: "avatars/1002/initial.jpg", updatedAt: "initialized" }
  };
}
