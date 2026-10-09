import { createHash } from "node:crypto";
import type { AccountId, MessageRecord } from "./contracts.js";
import { IMAGE_EXTENSION, WENLI_SENDER_ID, isImageMimeType } from "./contracts.js";
import { AppError } from "./errors.js";
import { isHumanWenliMention } from "./wenli-mention.js";

const CLIENT_MESSAGE_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function deterministicWenliReplyClientMessageId(sourceMessageId: string): string {
  return `reply_${createHash("sha256").update(sourceMessageId, "utf8").digest("hex").slice(0, 32)}`;
}

export function deterministicWenliReplyId(sourceMessageId: string): string {
  return `wenli_${deterministicWenliReplyClientMessageId(sourceMessageId)}`;
}

export function buildWenliReply(
  requesterId: AccountId,
  source: MessageRecord | null,
  rawBody: unknown,
  createdAt: string
): MessageRecord {
  assertBasicWenliSource(requesterId, source);
  const body = validWenliBody(rawBody);
  const clientMessageId = deterministicWenliReplyClientMessageId(source.id);
  return {
    id: `wenli_${clientMessageId}`,
    relationshipId: "couple",
    senderId: WENLI_SENDER_ID,
    recipientId: otherAccount(requesterId),
    clientMessageId,
    body,
    replyToMessageId: source.id,
    sourceMessageId: source.id,
    createdAt
  };
}

export function existingWenliReplyMatches(
  requesterId: AccountId,
  source: MessageRecord,
  reply: MessageRecord | null
): boolean | null {
  if (reply === null) return null;
  try {
    assertValidWenliSource(requesterId, source);
    const expectedId = deterministicWenliReplyId(source.id);
    if (reply.id !== expectedId ||
      reply.relationshipId !== "couple" ||
      reply.senderId !== WENLI_SENDER_ID ||
      reply.recipientId !== otherAccount(requesterId) ||
      reply.clientMessageId !== deterministicWenliReplyClientMessageId(source.id) ||
      reply.replyToMessageId !== source.id ||
      reply.sourceMessageId !== source.id ||
      reply.type === "image" ||
      reply.imageFileId !== undefined ||
      reply.imageMimeType !== undefined ||
      reply.imageWidth !== undefined ||
      reply.imageHeight !== undefined) {
      return false;
    }
    validWenliBody(reply.body);
    isoTimestamp(reply.createdAt);
    return true;
  } catch {
    return false;
  }
}

export function assertValidWenliSource(
  requesterId: AccountId,
  source: MessageRecord | null
): asserts source is MessageRecord & { senderId: AccountId } {
  if (!source ||
    source.relationshipId !== "couple" ||
    source.senderId !== requesterId ||
    source.recipientId !== otherAccount(requesterId) ||
    !CLIENT_MESSAGE_ID.test(source.clientMessageId) ||
    source.id !== `${source.senderId}_${source.clientMessageId}` ||
    source.sourceMessageId !== undefined ||
    !validSourceBody(source.body) ||
    !validIsoTimestamp(source.createdAt) ||
    !isHumanWenliMention(source)) {
    throw new AppError("WENLI_SOURCE_INVALID", "问理触发消息无效");
  }
  if (!validSourceImageFields(source)) {
    throw new AppError("WENLI_SOURCE_INVALID", "问理触发消息无效");
  }
}

function validSourceImageFields(source: MessageRecord): boolean {
  const hasAnyImageField = source.imageFileId !== undefined || source.imageMimeType !== undefined || source.imageWidth !== undefined || source.imageHeight !== undefined;
  if (source.type !== "image") return !hasAnyImageField;
  if (typeof source.imageFileId !== "string" || !isImageMimeType(source.imageMimeType) ||
    (source.imageWidth === undefined) !== (source.imageHeight === undefined)) return false;
  const { imageWidth, imageHeight } = source;
  if (imageWidth !== undefined && imageHeight !== undefined && (!Number.isInteger(imageWidth) || imageWidth < 1 || imageWidth > 20000 ||
    !Number.isInteger(imageHeight) || imageHeight < 1 || imageHeight > 20000)) return false;
  return source.imageFileId.startsWith("cloud://") && source.imageFileId.endsWith(`/chat-images/${source.senderId}_${source.clientMessageId}.${IMAGE_EXTENSION[source.imageMimeType]}`);
}

function assertBasicWenliSource(
  requesterId: AccountId,
  source: MessageRecord | null
): asserts source is MessageRecord {
  if (!source || source.senderId !== requesterId) {
    throw new AppError("WENLI_SOURCE_INVALID", "问理触发消息无效");
  }
}

function validWenliBody(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError("WENLI_REPLY_INVALID", "问理回复内容无效");
  }
  const body = value.trim();
  const length = [...body].length;
  if (length < 1 || length > 4000) {
    throw new AppError("WENLI_REPLY_INVALID", "问理回复内容无效");
  }
  return body;
}

function otherAccount(accountId: AccountId): AccountId {
  return accountId === "1001" ? "1002" : "1001";
}

function validSourceBody(value: string): boolean {
  const length = [...value.trim()].length;
  return length >= 1 && length <= 2000;
}

function validIsoTimestamp(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isoTimestamp(value: string): void {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error("invalid timestamp");
  }
}
