import { INITIAL_PROFILES, WENLI_SENDER_ID } from "../domain/contracts.js";
import type { AccountId, MessageSenderId, RelationshipRecord, UserRecord } from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import { isWenliMention } from "../domain/wenli-mention.js";
import { parseWenliMemoryRecord } from "../domain/wenli-memory.js";
import type { WenliMemoryRecord } from "../domain/wenli-memory.js";
import { deterministicWenliReplyId } from "../domain/wenli-reply.js";

export type BackupCollection =
  | "users"
  | "relationships"
  | "messages"
  | "moments"
  | "momentLikes"
  | "momentComments"
  | "readStates"
  | "wenliAgentJobs"
  | "wenliMemories";

export type AppendBackupCollection = Exclude<BackupCollection, "users" | "relationships">;

export interface BackupEntry {
  id: string;
  data: Record<string, unknown>;
}

export interface BackupData {
  users: BackupEntry[];
  relationships: BackupEntry[];
  messages: BackupEntry[];
  moments: BackupEntry[];
  momentLikes: BackupEntry[];
  momentComments: BackupEntry[];
  readStates: BackupEntry[];
  wenliAgentJobs: BackupEntry[];
  wenliMemories: BackupEntry[];
}

export type LegacyBackupData = Pick<BackupData, "users" | "relationships" | "messages">;

export interface CanonicalUserEntry {
  id: AccountId;
  data: UserRecord;
}

export interface CanonicalRelationshipEntry {
  id: "couple";
  data: RelationshipRecord;
}

const CLIENT_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SESSION_HASH = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;

export function canonicalizeBackupData(value: unknown): BackupData {
  const data = recordWithExactKeys(value, [
    "users", "relationships", "messages", "moments", "momentLikes", "momentComments", "readStates",
    "wenliAgentJobs", "wenliMemories"
  ]);
  const normalized: BackupData = {
    users: entriesValue("users", data.users),
    relationships: entriesValue("relationships", data.relationships),
    messages: entriesValue("messages", data.messages),
    moments: entriesValue("moments", data.moments),
    momentLikes: entriesValue("momentLikes", data.momentLikes),
    momentComments: entriesValue("momentComments", data.momentComments),
    readStates: entriesValue("readStates", data.readStates),
    wenliAgentJobs: entriesValue("wenliAgentJobs", data.wenliAgentJobs),
    wenliMemories: entriesValue("wenliMemories", data.wenliMemories)
  };
  const messages = new Map(normalized.messages.map((entry) => [entry.id, entry.data]));
  for (const entry of normalized.wenliAgentJobs) {
    const job = entry.data;
    if (job.type !== "mention") continue;
    if (typeof job.sourceMessageId !== "string") invalidDocument();
    const source = messages.get(job.sourceMessageId);
    if (!source || source.senderId !== job.requesterId) invalidDocument();
    if (job.status !== "succeeded") continue;
    const expected = deterministicWenliReplyId(job.sourceMessageId);
    const reply = messages.get(expected);
    if (job.responseMessageId !== expected || !reply || reply.senderId !== WENLI_SENDER_ID ||
      reply.sourceMessageId !== job.sourceMessageId || reply.replyToMessageId !== job.sourceMessageId ||
      reply.recipientId !== (job.requesterId === "1001" ? "1002" : "1001")) invalidDocument();
  }
  return normalized;
}

/** Canonicalizes the complete pre-v4 data shape and fills the v4-only collections. */
export function canonicalizeLegacyV3BackupData(value: unknown): BackupData {
  const data = recordWithExactKeys(value, [
    "users", "relationships", "messages", "moments", "momentLikes", "momentComments", "readStates"
  ]);
  return {
    users: entriesValue("users", data.users),
    relationships: entriesValue("relationships", data.relationships),
    messages: entriesValue("messages", data.messages),
    moments: entriesValue("moments", data.moments),
    momentLikes: entriesValue("momentLikes", data.momentLikes),
    momentComments: entriesValue("momentComments", data.momentComments),
    readStates: entriesValue("readStates", data.readStates),
    wenliAgentJobs: [],
    wenliMemories: []
  };
}

/** Canonicalizes the pre-v3 shape used by the v2 encrypted document. */
export function canonicalizeLegacyV2BackupData(value: unknown): BackupData {
  const data = recordWithExactKeys(value, [
    "users", "relationships", "messages", "moments", "momentLikes", "momentComments"
  ]);
  return canonicalizeLegacyV3BackupData({ ...data, readStates: [] });
}

export function canonicalizeLegacyBackupData(value: unknown): LegacyBackupData {
  const data = recordWithExactKeys(value, ["users", "relationships", "messages"]);
  return {
    users: entriesValue("users", data.users),
    relationships: entriesValue("relationships", data.relationships),
    messages: entriesValue("messages", data.messages)
  };
}

export function canonicalizeBackupEntry(collection: BackupCollection, value: unknown): BackupEntry {
  const entry = entryValue(value);
  if (collection === "users") {
    const canonical = userEntry(entry);
    return { id: canonical.id, data: { ...canonical.data } };
  }
  if (collection === "relationships") {
    const canonical = relationshipEntry(entry);
    return { id: canonical.id, data: { ...canonical.data } };
  }
  if (collection === "messages") return messageEntry(entry);
  if (collection === "moments") return momentEntry(entry);
  if (collection === "momentLikes") return momentLikeEntry(entry);
  if (collection === "momentComments") return momentCommentEntry(entry);
  if (collection === "readStates") return readStateEntry(entry);
  if (collection === "wenliAgentJobs") return wenliAgentJobEntry(entry);
  return wenliMemoryEntry(entry);
}

export function canonicalizeUserEntry(value: unknown): CanonicalUserEntry {
  return userEntry(entryValue(value));
}

export function canonicalizeRelationshipEntry(value: unknown): CanonicalRelationshipEntry {
  return relationshipEntry(entryValue(value));
}

function entriesValue(collection: BackupCollection, value: unknown): BackupEntry[] {
  if (!Array.isArray(value)) invalidDocument();
  return value.map((entry) => canonicalizeBackupEntry(collection, entry));
}

function entryValue(value: unknown): BackupEntry {
  const entry = recordWithExactKeys(value, ["id", "data"]);
  if (typeof entry.id !== "string" || !isRecord(entry.data)) invalidDocument();
  return { id: entry.id, data: entry.data };
}

function userEntry(entry: BackupEntry): CanonicalUserEntry {
  const data = entry.data;
  const accountId = accountIdValue(data.accountId);
  const displayName = displayNameValue(data.displayName);
  const fixedGender = INITIAL_PROFILES[accountId].gender;
  const gender = data.gender === undefined ? fixedGender : data.gender;
  const avatarKey = avatarKeyValue(data.avatarKey);
  const profileInitializedVersion = nonnegativeIntegerValue(data.profileInitializedVersion ?? 0);
  const passwordHash = passwordHashValue(data.passwordHash);
  const sessionHash = sessionHashValue(data.sessionHash);
  const sessionVersion = nonnegativeIntegerValue(data.sessionVersion);
  const updatedAt = timestampValue(data.updatedAt);
  if (!hasOnlyKeys(data, [
    "accountId", "displayName", "gender", "avatarKey", "profileInitializedVersion",
    "passwordHash", "sessionHash", "sessionVersion", "updatedAt"
  ]) || entry.id !== accountId || gender !== fixedGender) invalidDocument();
  return {
    id: accountId,
    data: {
      accountId,
      displayName,
      gender: fixedGender,
      avatarKey,
      profileInitializedVersion,
      passwordHash,
      sessionHash,
      sessionVersion,
      updatedAt
    }
  };
}

function relationshipEntry(entry: BackupEntry): CanonicalRelationshipEntry {
  const data = entry.data;
  const createdAt = timestampValue(data.createdAt);
  if (!hasExactKeys(data, ["id", "memberIds", "createdAt"]) ||
    entry.id !== "couple" || data.id !== "couple" || !Array.isArray(data.memberIds) ||
    data.memberIds.length !== 2 || data.memberIds[0] !== "1001" || data.memberIds[1] !== "1002") {
    invalidDocument();
  }
  return { id: "couple", data: { id: "couple", memberIds: ["1001", "1002"], createdAt } };
}

function messageEntry(entry: BackupEntry): BackupEntry {
  const data = entry.data;
  const senderId = messageSenderIdValue(data.senderId);
  const recipientId = accountIdValue(data.recipientId);
  const clientMessageId = clientIdValue(data.clientMessageId);
  const body = bodyValue(data.body, senderId === WENLI_SENDER_ID ? 4000 : 2000);
  const replyToMessageId = data.replyToMessageId === undefined
    ? undefined
    : messageIdValue(data.replyToMessageId);
  const sourceMessageId = data.sourceMessageId === undefined
    ? undefined
    : humanMessageIdValue(data.sourceMessageId);
  const type = data.type === undefined ? undefined : messageTypeValue(data.type);
  const imageFileId = data.imageFileId === undefined ? undefined : imageFileIdValue(data.imageFileId);
  const imageMimeType = data.imageMimeType === undefined ? undefined : imageMimeTypeValue(data.imageMimeType);
  const imageWidth = data.imageWidth === undefined ? undefined : positiveDimensionValue(data.imageWidth);
  const imageHeight = data.imageHeight === undefined ? undefined : positiveDimensionValue(data.imageHeight);
  const createdAt = timestampValue(data.createdAt);
  if (!hasOnlyKeys(data, [
    "id", "relationshipId", "senderId", "recipientId", "clientMessageId", "body",
    "replyToMessageId", "sourceMessageId", "type", "imageFileId", "imageMimeType", "imageWidth", "imageHeight", "createdAt",
    "wenliMentionPending"
  ]) || data.id !== entry.id || entry.id !== `${senderId}_${clientMessageId}` ||
    data.relationshipId !== "couple" || recipientId === senderId) invalidDocument();
  const hasMentionIntent = Object.prototype.hasOwnProperty.call(data, "wenliMentionPending");
  if (hasMentionIntent && (typeof data.wenliMentionPending !== "boolean" || senderId === WENLI_SENDER_ID ||
    !isWenliMention(body))) invalidDocument();
  if (senderId === WENLI_SENDER_ID) {
    if (sourceMessageId === undefined || replyToMessageId !== sourceMessageId) invalidDocument();
    if (type === "image") invalidDocument();
  } else if (sourceMessageId !== undefined) {
    invalidDocument();
  }
  if (type === "image") {
    if (imageFileId === undefined || imageMimeType === undefined ||
      (imageWidth === undefined) !== (imageHeight === undefined)) invalidDocument();
  } else {
    if (body.length < 1 || imageFileId !== undefined || imageMimeType !== undefined ||
      imageWidth !== undefined || imageHeight !== undefined) invalidDocument();
  }
  return {
    id: entry.id,
    data: {
      id: entry.id,
      relationshipId: "couple",
      senderId,
      recipientId,
      clientMessageId,
      body,
      ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
      ...(sourceMessageId === undefined ? {} : { sourceMessageId }),
      ...(hasMentionIntent ? { wenliMentionPending: data.wenliMentionPending } : {}),
      ...(type === undefined ? {} : { type }),
      ...(imageFileId === undefined ? {} : { imageFileId }),
      ...(imageMimeType === undefined ? {} : { imageMimeType }),
      ...(imageWidth === undefined ? {} : { imageWidth }),
      ...(imageHeight === undefined ? {} : { imageHeight }),
      createdAt
    }
  };
}

function momentEntry(entry: BackupEntry): BackupEntry {
  const data = entry.data;
  const authorId = accountIdValue(data.authorId);
  const clientMomentId = clientIdValue(data.clientMomentId);
  const body = textValue(data.body, 2000);
  const createdAt = timestampValue(data.createdAt);
  const interactionVersion = nonnegativeIntegerValue(data.interactionVersion ?? 0);
  const imageFileId = data.imageFileId === undefined ? undefined : imageFileIdValue(data.imageFileId);
  const imageMimeType = data.imageMimeType === undefined ? undefined : imageMimeTypeValue(data.imageMimeType);
  const imageWidth = data.imageWidth === undefined ? undefined : positiveDimensionValue(data.imageWidth);
  const imageHeight = data.imageHeight === undefined ? undefined : positiveDimensionValue(data.imageHeight);
  if (!hasOnlyKeys(data, [
    "id", "authorId", "clientMomentId", "body", "visibility",
    "imageFileId", "imageMimeType", "imageWidth", "imageHeight",
    "createdAt", "deleting", "interactionVersion"
  ]) || data.id !== entry.id || entry.id !== `${authorId}_${clientMomentId}` ||
    (data.visibility !== "PARTNER" && data.visibility !== "SELF") || typeof data.deleting !== "boolean" ||
    (imageFileId === undefined) !== (imageMimeType === undefined) ||
    (imageWidth === undefined) !== (imageHeight === undefined)) {
    invalidDocument();
  }
  return {
    id: entry.id,
    data: {
      id: entry.id,
      authorId,
      clientMomentId,
      body,
      visibility: data.visibility,
      ...(imageFileId === undefined ? {} : { imageFileId }),
      ...(imageMimeType === undefined ? {} : { imageMimeType }),
      ...(imageWidth === undefined ? {} : { imageWidth }),
      ...(imageHeight === undefined ? {} : { imageHeight }),
      createdAt,
      deleting: data.deleting,
      interactionVersion
    }
  };
}

function momentLikeEntry(entry: BackupEntry): BackupEntry {
  const data = entry.data;
  const momentId = momentIdValue(data.momentId);
  const accountId = accountIdValue(data.accountId);
  const createdAt = timestampValue(data.createdAt);
  if (!hasExactKeys(data, ["id", "momentId", "accountId", "createdAt"]) ||
    data.id !== entry.id || entry.id !== `${momentId}_${accountId}`) invalidDocument();
  return { id: entry.id, data: { id: entry.id, momentId, accountId, createdAt } };
}

function momentCommentEntry(entry: BackupEntry): BackupEntry {
  const data = entry.data;
  const momentId = momentIdValue(data.momentId);
  const authorId = accountIdValue(data.authorId);
  const clientCommentId = clientIdValue(data.clientCommentId);
  const body = textValue(data.body, 500);
  const replyToCommentId = data.replyToCommentId === undefined
    ? undefined
    : humanMessageIdValue(data.replyToCommentId);
  const createdAt = timestampValue(data.createdAt);
  if (!hasOnlyKeys(data, ["id", "momentId", "authorId", "clientCommentId", "body", "replyToCommentId", "createdAt"]) ||
    data.id !== entry.id || entry.id !== `${authorId}_${clientCommentId}`) invalidDocument();
  return {
    id: entry.id,
    data: {
      id: entry.id,
      momentId,
      authorId,
      clientCommentId,
      body,
      ...(replyToCommentId === undefined ? {} : { replyToCommentId }),
      createdAt
    }
  };
}

function readStateEntry(entry: BackupEntry): BackupEntry {
  const data = entry.data;
  const accountId = accountIdValue(data.accountId);
  const lastReadMessageId = data.lastReadMessageId === undefined ? undefined : messageIdValue(data.lastReadMessageId);
  const lastReadMessageCreatedAt = data.lastReadMessageCreatedAt === undefined
    ? undefined
    : timestampValue(data.lastReadMessageCreatedAt);
  const readReceiptMessageId = data.readReceiptMessageId === undefined
    ? undefined
    : messageIdValue(data.readReceiptMessageId);
  const readReceiptMessageCreatedAt = data.readReceiptMessageCreatedAt === undefined
    ? undefined
    : timestampValue(data.readReceiptMessageCreatedAt);
  const lastSeenMomentAt = data.lastSeenMomentAt === undefined
    ? undefined
    : timestampValue(data.lastSeenMomentAt);
  const updatedAt = timestampValue(data.updatedAt);
  if (!hasOnlyKeys(data, [
    "accountId", "lastReadMessageId", "lastReadMessageCreatedAt", "readReceiptMessageId",
    "readReceiptMessageCreatedAt", "lastSeenMomentAt", "updatedAt"
  ]) || entry.id !== accountId) invalidDocument();
  if ((lastReadMessageId === undefined) !== (lastReadMessageCreatedAt === undefined)) invalidDocument();
  if ((readReceiptMessageId === undefined) !== (readReceiptMessageCreatedAt === undefined)) invalidDocument();
  return {
    id: entry.id,
    data: {
      accountId,
      ...(lastReadMessageId === undefined ? {} : { lastReadMessageId }),
      ...(lastReadMessageCreatedAt === undefined ? {} : { lastReadMessageCreatedAt }),
      ...(readReceiptMessageId === undefined ? {} : { readReceiptMessageId }),
      ...(readReceiptMessageCreatedAt === undefined ? {} : { readReceiptMessageCreatedAt }),
      ...(lastSeenMomentAt === undefined ? {} : { lastSeenMomentAt }),
      updatedAt
    }
  };
}

function wenliAgentJobEntry(entry: BackupEntry): BackupEntry {
  const data = entry.data;
  const allowed = [
    "id", "type", "requesterId", "sourceMessageId", "status", "attemptCount", "nextAttemptAt",
    "leaseUntil", "leaseToken", "responseMessageId", "lastErrorCode", "createdAt", "updatedAt"
  ];
  if (!hasOnlyKeys(data, allowed)) invalidDocument();
  const id = limitedStringValue(data.id, 200);
  const type = data.type;
  if (type !== "mention" && type !== "warmup") invalidDocument();
  const requesterId = accountIdValue(data.requesterId);
  const sourceMessageId = data.sourceMessageId === undefined
    ? undefined
    : humanMessageIdValue(data.sourceMessageId);
  if ((type === "mention" && (sourceMessageId === undefined || sourceMessageId !== id)) ||
    (type === "warmup" && sourceMessageId !== undefined)) invalidDocument();
  const status = data.status;
  if (status !== "pending" && status !== "running" && status !== "retry" &&
    status !== "succeeded" && status !== "dead") invalidDocument();
  const attemptCount = data.attemptCount;
  if (typeof attemptCount !== "number" || !Number.isSafeInteger(attemptCount) || attemptCount < 0) {
    invalidDocument();
  }
  const nextAttemptAt = data.nextAttemptAt === undefined ? undefined : timestampValue(data.nextAttemptAt);
  const leaseUntil = data.leaseUntil === undefined ? undefined : timestampValue(data.leaseUntil);
  const leaseToken = data.leaseToken === undefined ? undefined : limitedStringValue(data.leaseToken, 200);
  const responseMessageId = data.responseMessageId === undefined
    ? undefined
    : messageIdValue(data.responseMessageId);
  const lastErrorCode = data.lastErrorCode === undefined
    ? undefined
    : limitedStringValue(data.lastErrorCode, 200);
  const createdAt = timestampValue(data.createdAt);
  const updatedAt = timestampValue(data.updatedAt);
  if ((status === "pending" || status === "retry") && nextAttemptAt === undefined) invalidDocument();
  if (status === "running" && (leaseUntil === undefined || leaseToken === undefined)) invalidDocument();
  if (status === "succeeded" && responseMessageId === undefined) invalidDocument();
  if (entry.id !== id) invalidDocument();
  return {
    id,
    data: {
      id,
      type,
      requesterId,
      ...(sourceMessageId === undefined ? {} : { sourceMessageId }),
      status,
      attemptCount,
      ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
      ...(leaseUntil === undefined ? {} : { leaseUntil }),
      ...(leaseToken === undefined ? {} : { leaseToken }),
      ...(responseMessageId === undefined ? {} : { responseMessageId }),
      ...(lastErrorCode === undefined ? {} : { lastErrorCode }),
      createdAt,
      updatedAt
    }
  };
}

function wenliMemoryEntry(entry: BackupEntry): BackupEntry {
  const allowed = [
    "id", "kind", "summary", "speakerIds", "sourceEventIds", "salience", "status",
    "supersedesId", "validFrom", "validTo", "createdAt", "updatedAt"
  ];
  if (!hasOnlyKeys(entry.data, allowed)) invalidDocument();
  let memory: WenliMemoryRecord;
  try {
    memory = parseWenliMemoryRecord(entry.data);
  } catch {
    invalidDocument();
  }
  if (entry.id !== memory.id) invalidDocument();
  return { id: memory.id, data: { ...memory } };
}

function accountIdValue(value: unknown): AccountId {
  if (value !== "1001" && value !== "1002") invalidDocument();
  return value;
}

function messageSenderIdValue(value: unknown): MessageSenderId {
  if (value !== "1001" && value !== "1002" && value !== WENLI_SENDER_ID) invalidDocument();
  return value;
}

function displayNameValue(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || [...value].length < 1 || [...value].length > 30) {
    invalidDocument();
  }
  return value;
}

function passwordHashValue(value: unknown): string {
  if (typeof value !== "string") invalidDocument();
  const parts = value.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" ||
    !isCanonicalBase64(parts[1], 16) || !isCanonicalBase64(parts[2], 32)) invalidDocument();
  return value;
}

function sessionHashValue(value: unknown): string | null {
  if (value !== null && (typeof value !== "string" || !SESSION_HASH.test(value))) invalidDocument();
  return value;
}

function avatarKeyValue(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value !== value.trim() ||
    [...value].length < 1 || [...value].length > 2048 || CONTROL_CHARACTER.test(value)) invalidDocument();
  return value;
}

function isCanonicalBase64(value: string | undefined, expectedBytes: number): boolean {
  if (value === undefined || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  const bytes = Buffer.from(value, "base64");
  return bytes.byteLength === expectedBytes && bytes.toString("base64") === value;
}

function clientIdValue(value: unknown): string {
  if (typeof value !== "string" || !CLIENT_ID.test(value)) invalidDocument();
  return value;
}

function limitedStringValue(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || CONTROL_CHARACTER.test(value)) {
    invalidDocument();
  }
  return value;
}

function momentIdValue(value: unknown): string {
  if (typeof value !== "string") invalidDocument();
  const separator = value.indexOf("_");
  const accountId = value.slice(0, separator);
  const clientId = value.slice(separator + 1);
  if ((accountId !== "1001" && accountId !== "1002") || !CLIENT_ID.test(clientId)) invalidDocument();
  return value;
}

function messageIdValue(value: unknown): string {
  if (typeof value !== "string") invalidDocument();
  const separator = value.indexOf("_");
  const senderId = value.slice(0, separator);
  const clientId = value.slice(separator + 1);
  if ((senderId !== "1001" && senderId !== "1002" && senderId !== WENLI_SENDER_ID) ||
    !CLIENT_ID.test(clientId)) invalidDocument();
  return value;
}

function humanMessageIdValue(value: unknown): string {
  if (typeof value !== "string") invalidDocument();
  const separator = value.indexOf("_");
  const accountId = value.slice(0, separator);
  const clientId = value.slice(separator + 1);
  if ((accountId !== "1001" && accountId !== "1002") || !CLIENT_ID.test(clientId)) invalidDocument();
  return value;
}

function textValue(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value !== value.trim() || [...value].length < 1 || [...value].length > maximum) {
    invalidDocument();
  }
  return value;
}

function bodyValue(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value !== value.trim() || [...value].length > maximum) invalidDocument();
  return value;
}

function messageTypeValue(value: unknown): "text" | "image" {
  if (value !== "text" && value !== "image") invalidDocument();
  return value;
}

function imageMimeTypeValue(value: unknown): string {
  if (value !== "image/jpeg" && value !== "image/png" && value !== "image/webp") invalidDocument();
  return value;
}

function imageFileIdValue(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("cloud://") ||
    (!value.includes("/chat-images/") && !value.includes("/moments-images/"))
  ) {
    invalidDocument();
  }
  return value;
}

function positiveDimensionValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 20000) invalidDocument();
  return value;
}

function timestampValue(value: unknown): string {
  if (typeof value !== "string") invalidDocument();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) invalidDocument();
  return value;
}

function nonnegativeIntegerValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalidDocument();
  return value;
}

function recordWithExactKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, keys)) invalidDocument();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(data: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(data).length === keys.length && hasOnlyKeys(data, keys);
}

function hasOnlyKeys(data: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(data).every((key) => allowed.has(key));
}

function invalidDocument(): never {
  throw new AppError("BACKUP_FORMAT_INVALID", "备份记录格式无效");
}
