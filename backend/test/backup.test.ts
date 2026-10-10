import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertBackupDocument,
  decryptBackup,
  encryptBackup,
  type BackupData,
  type BackupEntry
} from "../src/backup/encrypted-backup.js";
import { VALID_PASSWORD_HASH, validBackupData, validWenliMessageEntry, completedWenliBackup } from "./backup-fixtures.js";
import { canonicalizeBackupEntry } from "../src/backup/backup-validator.js";
import { IMAGE_MESSAGE_PLACEHOLDER } from "../src/domain/contracts.js";
import { deterministicWenliReplyId, deterministicWenliReplyClientMessageId } from "../src/domain/wenli-reply.js";

const sample: BackupData = validBackupData();

describe("encrypted chat backup", () => {
  it.each(["source", "reply", "requester", "response identity"])("rejects a v4 job snapshot with missing or inconsistent %s", async (failure) => {
    const data = completedWenliBackup();
    const job = data.wenliAgentJobs[0]!.data;
    if (failure === "source") data.messages = data.messages.filter((entry) => entry.id !== job.sourceMessageId);
    if (failure === "reply") data.messages = data.messages.filter((entry) => entry.id !== job.responseMessageId);
    if (failure === "requester") job.requesterId = "1002";
    if (failure === "response identity") job.responseMessageId = "wenli_reply_other";
    await expect(encryptBackup(data, "snapshot passphrase")).rejects.toThrow();
  });

  it("round trips a complete succeeded job with its source and deterministic reply", async () => {
    const data = completedWenliBackup();
    const restored = await decryptBackup(await encryptBackup(data, "snapshot passphrase"), "snapshot passphrase");
    expect(restored.data.wenliAgentJobs).toEqual(data.wenliAgentJobs);
    expect(restored.data.messages).toEqual(data.messages);
  });
  it.each([true, false])("preserves the exact optional mention-intent state %s through canonicalization and encrypted restore", async (pending) => {
    const data = validBackupData();
    data.messages[0]!.data.body = "@小Q 在吗";
    data.messages[0]!.data.wenliMentionPending = pending;
    expect(canonicalizeBackupEntry("messages", data.messages[0])).toEqual(data.messages[0]);
    const encrypted = await encryptBackup(data, "mention backup passphrase");
    const restored = await decryptBackup(encrypted, "mention backup passphrase");
    expect(restored.data).toEqual(data);
  });

  it.each(["true", 1, null, {}, []])("rejects non-boolean mention-intent metadata: %j", (pending) => {
    const entry = validBackupData().messages[0]!;
    entry.data.body = "@小Q 在吗";
    entry.data.wenliMentionPending = pending;
    expect(() => canonicalizeBackupEntry("messages", entry)).toThrowError(expect.objectContaining({ code: "BACKUP_FORMAT_INVALID" }));
  });

  it.each([true, false])("rejects mention-intent metadata %s on ordinary, image, and Wenli messages", (pending) => {
    const ordinary = validBackupData().messages[0]!;
    const image = structuredClone(ordinary);
    Object.assign(image.data, { type: "image", body: "", imageFileId: "cloud://env/chat-images/1001_m-1.jpg", imageMimeType: "image/jpeg" });
    for (const entry of [ordinary, image, validWenliMessageEntry("1001_m-1", "@小Q 回答")]) {
      entry.data.wenliMentionPending = pending;
      expect(() => canonicalizeBackupEntry("messages", entry)).toThrowError(expect.objectContaining({ code: "BACKUP_FORMAT_INVALID" }));
    }
  });

  it("round-trips with AES-GCM without exposing message text", async () => {
    const encrypted = await encryptBackup(sample, "long backup passphrase", () => new Date("2026-08-06T00:00:00.000Z"));

    expect(encrypted.toString("utf8")).not.toContain("hello");
    await expect(decryptBackup(encrypted, "long backup passphrase")).resolves.toEqual({
      version: 4,
      exportedAt: "2026-08-06T00:00:00.000Z",
      data: sample,
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  });

  it("validates a legacy v1 checksum before normalizing the document to v4", async () => {
    const legacyData = {
      users: sample.users,
      relationships: sample.relationships,
      messages: sample.messages
    };
    const encrypted = legacyEncryptedFixture(legacyData, "legacy backup passphrase");

    await expect(decryptBackup(encrypted, "legacy backup passphrase")).resolves.toEqual({
      version: 4,
      exportedAt: "2026-08-05T00:00:00.000Z",
      data: {
        users: sample.users,
        relationships: sample.relationships,
        messages: sample.messages,
        moments: [],
        momentLikes: [],
        momentComments: [],
        readStates: [],
        wenliAgentJobs: [],
        wenliMemories: []
      },
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/)
    });

    const badChecksum = legacyEncryptedFixture(legacyData, "legacy backup passphrase", "0".repeat(64));
    await expect(decryptBackup(badChecksum, "legacy backup passphrase"))
      .rejects.toMatchObject({ code: "BACKUP_CHECKSUM_INVALID" });
  });

  it("normalizes an old v3 backup without treating it as a complete v4 export", async () => {
    const { wenliAgentJobs: _jobs, wenliMemories: _memories, ...oldData } = sample;
    void _jobs;
    void _memories;
    const encrypted = encryptedDocumentFixture({
      version: 3,
      exportedAt: "2026-08-05T00:00:00.000Z",
      data: oldData,
      checksum: createHash("sha256").update(JSON.stringify(oldData)).digest("hex")
    }, "legacy v3 passphrase");

    await expect(decryptBackup(encrypted, "legacy v3 passphrase")).resolves.toMatchObject({
      version: 4,
      data: { wenliAgentJobs: [], wenliMemories: [] }
    });
  });

  it("normalizes an old v2 backup and fills the v3/v4-only collections", async () => {
    const data = validBackupData();
    const oldData = {
      users: data.users,
      relationships: data.relationships,
      messages: data.messages,
      moments: data.moments,
      momentLikes: data.momentLikes,
      momentComments: data.momentComments
    };
    const encrypted = v2EncryptedFixture(oldData, "legacy v2 passphrase");

    await expect(decryptBackup(encrypted, "legacy v2 passphrase")).resolves.toMatchObject({
      version: 4,
      data: {
        ...oldData,
        readStates: [],
        wenliAgentJobs: [],
        wenliMemories: []
      }
    });
  });

  it("requires both Wenli collections in a v4 document", () => {
    const data = { ...sample } as Record<string, unknown>;
    delete data.wenliMemories;
    const checksum = createHash("sha256").update(JSON.stringify(data)).digest("hex");
    expect(() => assertBackupDocument({
      version: 4,
      exportedAt: "2026-08-06T00:00:00.000Z",
      data,
      checksum
    })).toThrowError(expect.objectContaining({ code: "BACKUP_FORMAT_INVALID" }));
  });

  it("accepts new messages with reply references without rewriting legacy messages", async () => {
    const data = validBackupData();
    data.messages.push({
      id: "1002_reply-1",
      data: {
        id: "1002_reply-1",
        relationshipId: "couple",
        senderId: "1002",
        recipientId: "1001",
        clientMessageId: "reply-1",
        body: "引用回复",
        replyToMessageId: data.messages[0]!.id,
        createdAt: "2026-08-07T00:00:06.000Z"
      }
    });

    const encrypted = await encryptBackup(data, "reply backup passphrase");
    const restored = await decryptBackup(encrypted, "reply backup passphrase");

    expect(restored.data.messages[0]!.data).not.toHaveProperty("replyToMessageId");
    expect(restored.data.messages.at(-1)!.data.replyToMessageId).toBe(data.messages[0]!.id);
  });

  it("round-trips Wenli replies with immutable source tracing", async () => {
    const data = validBackupData();
    const sourceId = data.messages[0]!.id;
    const wenliReply = validWenliMessageEntry(sourceId, "问".repeat(4000));
    data.messages.push(wenliReply, {
      id: "1002_after-wenli",
      data: {
        id: "1002_after-wenli",
        relationshipId: "couple",
        senderId: "1002",
        recipientId: "1001",
        clientMessageId: "after-wenli",
        body: "收到啦",
        replyToMessageId: wenliReply.id,
        createdAt: "2026-08-07T00:00:07.000Z"
      }
    });
    data.readStates[0]!.data.lastReadMessageId = wenliReply.id;
    data.readStates[0]!.data.lastReadMessageCreatedAt = "2026-08-07T00:00:06.000Z";

    const encrypted = await encryptBackup(data, "wenli backup passphrase");
    const restored = await decryptBackup(encrypted, "wenli backup passphrase");

    expect(restored.data.messages[1]).toEqual(wenliReply);
    expect(restored.data.messages[2]!.data.replyToMessageId).toBe(wenliReply.id);
    expect(restored.data.readStates[0]!.data.lastReadMessageId).toBe(wenliReply.id);
  });

  it("backs up both unfinished and completed Wenli jobs together with dynamic memories", async () => {
    const base = validBackupData();
    base.messages.push({ id: "1002_m-2", data: { ...base.messages[0]!.data, id: "1002_m-2",
      clientMessageId: "m-2", senderId: "1002", recipientId: "1001", body: "@小Q 你好" } });
    const replyId = deterministicWenliReplyId("1002_m-2");
    const reply = validWenliMessageEntry("1002_m-2");
    base.messages.push({ id: replyId, data: { ...reply.data, id: replyId,
      clientMessageId: deterministicWenliReplyClientMessageId("1002_m-2"), recipientId: "1001" } });
    const data = {
      ...base,
      wenliAgentJobs: [
        {
          id: "1001_m-1",
          data: {
            id: "1001_m-1",
            type: "mention",
            requesterId: "1001",
            sourceMessageId: "1001_m-1",
            status: "pending",
            attemptCount: 0,
            nextAttemptAt: "2026-08-07T00:00:05.000Z",
            createdAt: "2026-08-07T00:00:05.000Z",
            updatedAt: "2026-08-07T00:00:05.000Z"
          }
        },
        {
          id: "1002_m-2",
          data: {
            id: "1002_m-2",
            type: "mention",
            requesterId: "1002",
            sourceMessageId: "1002_m-2",
            status: "succeeded",
            attemptCount: 1,
            responseMessageId: replyId,
            createdAt: "2026-08-07T00:00:05.000Z",
            updatedAt: "2026-08-07T00:00:06.000Z"
          }
        }
      ],
      wenliMemories: [
        {
          id: "mem_dynamic_1",
          data: {
            id: "mem_dynamic_1",
            kind: "fact",
            summary: "他们喜欢一起回忆童年。",
            speakerIds: ["1001", "1002"],
            sourceEventIds: ["1001_m-1"],
            salience: 50,
            status: "active",
            createdAt: "2026-08-07T00:00:06.000Z",
            updatedAt: "2026-08-07T00:00:06.000Z"
          }
        }
      ]
    } as BackupData;

    const encrypted = await encryptBackup(data, "Wenli jobs backup passphrase");
    const restored = await decryptBackup(encrypted, "Wenli jobs backup passphrase");

    expect(restored.data.wenliAgentJobs).toEqual(data.wenliAgentJobs);
    expect(restored.data.wenliMemories).toEqual(data.wenliMemories);
  });

  it.each([
    ["missing source", (entry: BackupEntry) => { delete entry.data.sourceMessageId; }],
    ["mismatched trace", (entry: BackupEntry) => { entry.data.replyToMessageId = "1002_other"; }],
    ["Wenli source", (entry: BackupEntry) => {
      entry.data.replyToMessageId = "wenli_reply_other";
      entry.data.sourceMessageId = "wenli_reply_other";
    }],
    ["image payload", (entry: BackupEntry) => {
      entry.data.body = "";
      entry.data.type = "image";
      entry.data.imageFileId = "cloud://env-bucket/chat-images/wenli_image.jpg";
      entry.data.imageMimeType = "image/jpeg";
    }]
  ])("rejects a Wenli reply with %s", async (_case, mutate) => {
    const data = validBackupData();
    const reply = validWenliMessageEntry(data.messages[0]!.id);
    mutate(reply);
    data.messages.push(reply);

    await expect(encryptBackup(data, "invalid wenli backup passphrase"))
      .rejects.toMatchObject({ code: "BACKUP_FORMAT_INVALID" });
  });

  it("rejects source tracing fields on a human message", async () => {
    const data = validBackupData();
    data.messages[0]!.data.replyToMessageId = "1002_other";
    data.messages[0]!.data.sourceMessageId = "1002_other";

    await expect(encryptBackup(data, "invalid human backup passphrase"))
      .rejects.toMatchObject({ code: "BACKUP_FORMAT_INVALID" });
  });

  it("accepts comment replies with a reply reference without rewriting legacy comments", async () => {
    const data = validBackupData();
    const root = data.momentComments[0]!;
    data.momentComments.push({
      id: "1001_reply-comment-1",
      data: {
        id: "1001_reply-comment-1",
        momentId: root.data.momentId,
        authorId: "1001",
        clientCommentId: "reply-comment-1",
        body: "回复评论",
        replyToCommentId: root.id,
        createdAt: "2026-08-07T00:00:08.000Z"
      }
    });

    const encrypted = await encryptBackup(data, "reply comment backup passphrase");
    const restored = await decryptBackup(encrypted, "reply comment backup passphrase");

    expect(restored.data.momentComments[0]!.data).not.toHaveProperty("replyToCommentId");
    expect(restored.data.momentComments.at(-1)!.data.replyToCommentId).toBe(root.id);
  });

  it("accepts image messages with metadata without rewriting legacy text backups", async () => {
    const data = validBackupData();
    data.messages.push({
      id: "1001_img-1",
      data: {
        id: "1001_img-1",
        relationshipId: "couple",
        senderId: "1001",
        recipientId: "1002",
        clientMessageId: "img-1",
        body: "",
        type: "image",
        imageFileId: "cloud://env-bucket/chat-images/1001_img-1.jpg",
        imageMimeType: "image/jpeg",
        imageWidth: 800,
        imageHeight: 600,
        createdAt: "2026-08-07T00:00:07.000Z"
      }
    });

    const encrypted = await encryptBackup(data, "image backup passphrase");
    const restored = await decryptBackup(encrypted, "image backup passphrase");
    const imageMessage = restored.data.messages.at(-1)!.data;
    expect(imageMessage).toMatchObject({
      type: "image",
      imageFileId: "cloud://env-bucket/chat-images/1001_img-1.jpg",
      imageMimeType: "image/jpeg",
      imageWidth: 800,
      imageHeight: 600
    });
    expect(restored.data.messages[0]!.data).not.toHaveProperty("type");
  });

  it("accepts a captioned @小Q image with a pending mention intent", async () => {
    const image = {
      id: "1001_img-caption",
      data: {
        id: "1001_img-caption",
        relationshipId: "couple",
        senderId: "1001",
        recipientId: "1002",
        clientMessageId: "img-caption",
        body: "@小Q 看看这张图",
        type: "image",
        imageFileId: "cloud://env/chat-images/1001_img-caption.jpg",
        imageMimeType: "image/jpeg",
        imageWidth: 800,
        imageHeight: 600,
        wenliMentionPending: true,
        createdAt: "2026-08-07T00:00:07.000Z"
      }
    };
    expect(canonicalizeBackupEntry("messages", image)).toEqual(image);

    const data = validBackupData();
    data.messages.push(image);
    const encrypted = await encryptBackup(data, "captioned image backup passphrase");
    const restored = await decryptBackup(encrypted, "captioned image backup passphrase");
    expect(restored.data.messages.at(-1)!.data).toEqual(image.data);
  });

  it("rejects a placeholder image message with a pending mention intent", () => {
    const image = {
      id: "1001_img-placeholder",
      data: {
        id: "1001_img-placeholder",
        relationshipId: "couple",
        senderId: "1001",
        recipientId: "1002",
        clientMessageId: "img-placeholder",
        body: IMAGE_MESSAGE_PLACEHOLDER,
        type: "image",
        imageFileId: "cloud://env/chat-images/1001_img-placeholder.jpg",
        imageMimeType: "image/jpeg",
        wenliMentionPending: true,
        createdAt: "2026-08-07T00:00:07.000Z"
      }
    };
    expect(() => canonicalizeBackupEntry("messages", image))
      .toThrowError(expect.objectContaining({ code: "BACKUP_FORMAT_INVALID" }));
  });

  it("rejects an image caption longer than 2000 characters", () => {
    const image = {
      id: "1001_img-long-caption",
      data: {
        id: "1001_img-long-caption",
        relationshipId: "couple",
        senderId: "1001",
        recipientId: "1002",
        clientMessageId: "img-long-caption",
        body: "@小Q " + "喵".repeat(2000),
        type: "image",
        imageFileId: "cloud://env/chat-images/1001_img-long-caption.jpg",
        imageMimeType: "image/jpeg",
        createdAt: "2026-08-07T00:00:07.000Z"
      }
    };
    expect(() => canonicalizeBackupEntry("messages", image))
      .toThrowError(expect.objectContaining({ code: "BACKUP_FORMAT_INVALID" }));
  });

  it("verifies a legacy checksum against the exact parsed key order before normalization", async () => {
    const legacyData = {
      messages: [{
        data: {
          createdAt: "2026-08-07T00:00:05.000Z",
          body: "hello",
          clientMessageId: "m-ordered",
          recipientId: "1002",
          senderId: "1001",
          relationshipId: "couple",
          id: "1001_m-ordered"
        },
        id: "1001_m-ordered"
      }],
      users: [{
        data: {
          updatedAt: "2026-08-07T00:00:00.000Z",
          sessionVersion: 2,
          sessionHash: null,
          passwordHash: VALID_PASSWORD_HASH,
          profileInitializedVersion: 1,
          avatarKey: null,
          gender: "女",
          displayName: "ordered",
          accountId: "1001"
        },
        id: "1001"
      }],
      relationships: [{
        data: {
          createdAt: "2026-08-07T00:00:00.000Z",
          memberIds: ["1001", "1002"],
          id: "couple"
        },
        id: "couple"
      }]
    };
    const encrypted = legacyEncryptedFixture(legacyData, "legacy ordered passphrase");

    const normalized = await decryptBackup(encrypted, "legacy ordered passphrase");

    expect(normalized).toEqual({
      version: 4,
      exportedAt: "2026-08-05T00:00:00.000Z",
      data: {
        users: legacyData.users,
        relationships: legacyData.relationships,
        messages: legacyData.messages,
        moments: [],
        momentLikes: [],
        momentComments: [],
        readStates: [],
        wenliAgentJobs: [],
        wenliMemories: []
      },
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(() => assertBackupDocument(normalized)).not.toThrow();
  });

  it.each([
    ["messages", (data: BackupData) => { data.messages[0]!.data.senderId = "1002"; }],
    ["momentComments", (data: BackupData) => { data.momentComments[0]!.data.authorId = "1001"; }]
  ])("rejects a checksummed v2 backup with an invalid final %s record", async (_collection, mutate) => {
    const data = validBackupData();
    mutate(data);
    const encrypted = v2EncryptedFixture(data, "semantic backup passphrase");

    await expect(decryptBackup(encrypted, "semantic backup passphrase"))
      .rejects.toMatchObject({ code: "BACKUP_FORMAT_INVALID" });
  });

  it("rejects a wrong passphrase or modified ciphertext", async () => {
    const encrypted = await encryptBackup(sample, "correct long passphrase");
    await expect(decryptBackup(encrypted, "wrong long passphrase")).rejects.toMatchObject({ code: "BACKUP_DECRYPT_FAILED" });

    const tampered = Buffer.from(encrypted);
    const index = tampered.length - 2;
    tampered[index] = tampered[index]! ^ 1;
    await expect(decryptBackup(tampered, "correct long passphrase")).rejects.toMatchObject({ code: "BACKUP_DECRYPT_FAILED" });
  });

  it("rejects a decrypted document whose checksum does not match", () => {
    expect(() => assertBackupDocument({
      version: 4,
      exportedAt: "2026-08-06T00:00:00.000Z",
      data: sample,
      checksum: "0".repeat(64)
    })).toThrowError(expect.objectContaining({ code: "BACKUP_CHECKSUM_INVALID" }));
  });

  it("rejects malformed v1 and v2 document shapes", async () => {
    const malformedV1 = legacyEncryptedFixture({
      users: sample.users,
      relationships: sample.relationships
    }, "legacy backup passphrase");
    await expect(decryptBackup(malformedV1, "legacy backup passphrase"))
      .rejects.toMatchObject({ code: "BACKUP_FORMAT_INVALID" });

    const malformedV2Data = {
      users: sample.users,
      relationships: sample.relationships,
      messages: sample.messages,
      moments: [],
      momentLikes: []
    };
    expect(() => assertBackupDocument({
      version: 4,
      exportedAt: "2026-08-06T00:00:00.000Z",
      data: malformedV2Data,
      checksum: createHash("sha256").update(JSON.stringify(malformedV2Data)).digest("hex")
    })).toThrowError(expect.objectContaining({ code: "BACKUP_FORMAT_INVALID" }));
  });
});

function legacyEncryptedFixture(
  data: Record<string, unknown>,
  passphrase: string,
  checksum = createHash("sha256").update(JSON.stringify(data)).digest("hex")
): Buffer {
  return encryptedDocumentFixture({
    version: 1,
    exportedAt: "2026-08-05T00:00:00.000Z",
    data,
    checksum
  }, passphrase);
}

function v2EncryptedFixture(
  data: Pick<BackupData, "users" | "relationships" | "messages" | "moments" | "momentLikes" | "momentComments">,
  passphrase: string
): Buffer {
  const legacyData = data;
  return encryptedDocumentFixture({
    version: 2,
    exportedAt: "2026-08-05T00:00:00.000Z",
    data: legacyData,
    checksum: createHash("sha256").update(JSON.stringify(legacyData)).digest("hex")
  }, passphrase);
}

function encryptedDocumentFixture(document: Record<string, unknown>, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(document);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.from(JSON.stringify({
    format: "couple-chat-backup",
    version: 1,
    kdf: "scrypt",
    cipher: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  }), "utf8");
}
