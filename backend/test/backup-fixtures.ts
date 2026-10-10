import { INITIAL_PROFILES, type AccountId } from "../src/domain/contracts.js";
import type { BackupData, BackupEntry } from "../src/backup/encrypted-backup.js";
import { buildWenliReply } from "../src/domain/wenli-reply.js";

export function completedWenliBackup(): BackupData {
  const data = validBackupData();
  const source = { id: "1001_complete", relationshipId: "couple" as const, senderId: "1001" as const,
    recipientId: "1002" as const, clientMessageId: "complete", body: "@小Q 你好", createdAt: "2026-08-07T00:00:00.000Z" };
  const reply = buildWenliReply("1001", source, "我在呢", "2026-08-07T00:00:01.000Z");
  data.messages.push({ id: source.id, data: { ...source } }, { id: reply.id, data: { ...reply } });
  data.wenliAgentJobs.push({ id: source.id, data: { id: source.id, type: "mention", requesterId: "1001",
    sourceMessageId: source.id, status: "succeeded", attemptCount: 1, responseMessageId: reply.id,
    createdAt: source.createdAt, updatedAt: reply.createdAt } });
  return data;
}

export const VALID_PASSWORD_HASH = `scrypt$${Buffer.alloc(16, 1).toString("base64")}$${
  Buffer.alloc(32, 2).toString("base64")
}`;

export function validUserEntry(accountId: AccountId = "1001"): BackupEntry {
  return {
    id: accountId,
    data: {
      accountId,
      ...INITIAL_PROFILES[accountId],
      avatarKey: null,
      profileInitializedVersion: 1,
      passwordHash: VALID_PASSWORD_HASH,
      sessionHash: null,
      sessionVersion: 2,
      updatedAt: "2026-08-07T00:00:00.000Z"
    }
  };
}

export function validRelationshipEntry(): BackupEntry {
  return {
    id: "couple",
    data: { id: "couple", memberIds: ["1001", "1002"], createdAt: "2026-08-07T00:00:00.000Z" }
  };
}

export function validMessageEntry(): BackupEntry {
  return {
    id: "1001_m-1",
    data: {
      id: "1001_m-1",
      relationshipId: "couple",
      senderId: "1001",
      recipientId: "1002",
      clientMessageId: "m-1",
      body: "hello",
      createdAt: "2026-08-07T00:00:05.000Z"
    }
  };
}

export function validWenliMessageEntry(sourceMessageId = "1001_m-1", body = "我在呢"): BackupEntry {
  const clientMessageId = "reply_0123456789abcdef0123456789abcdef";
  const id = `wenli_${clientMessageId}`;
  return {
    id,
    data: {
      id,
      relationshipId: "couple",
      senderId: "wenli",
      recipientId: "1002",
      clientMessageId,
      body,
      replyToMessageId: sourceMessageId,
      sourceMessageId,
      createdAt: "2026-08-07T00:00:06.000Z"
    }
  };
}

export function validMomentEntry(): BackupEntry {
  return {
    id: "1001_post-1",
    data: {
      id: "1001_post-1",
      authorId: "1001",
      clientMomentId: "post-1",
      body: "moment",
      visibility: "PARTNER",
      createdAt: "2026-08-07T00:00:01.000Z",
      deleting: false,
      interactionVersion: 2
    }
  };
}

export function validLikeEntry(): BackupEntry {
  return {
    id: "1001_post-1_1002",
    data: {
      id: "1001_post-1_1002",
      momentId: "1001_post-1",
      accountId: "1002",
      createdAt: "2026-08-07T00:00:02.000Z"
    }
  };
}

export function validCommentEntry(): BackupEntry {
  return {
    id: "1002_comment-1",
    data: {
      id: "1002_comment-1",
      momentId: "1001_post-1",
      authorId: "1002",
      clientCommentId: "comment-1",
      body: "comment",
      createdAt: "2026-08-07T00:00:03.000Z"
    }
  };
}

export function validReadStateEntry(): BackupEntry {
  return {
    id: "1001",
    data: {
      accountId: "1001",
      lastReadMessageId: "1002_message-1",
      lastReadMessageCreatedAt: "2026-08-07T00:00:10.000Z",
      updatedAt: "2026-08-07T00:00:10.000Z"
    }
  };
}

export function validBackupData(): BackupData {
  return {
    users: [validUserEntry()],
    relationships: [validRelationshipEntry()],
    messages: [validMessageEntry()],
    moments: [validMomentEntry()],
    momentLikes: [validLikeEntry()],
    momentComments: [validCommentEntry()],
    readStates: [validReadStateEntry()],
    wenliAgentJobs: [],
    wenliMemories: []
  };
}
