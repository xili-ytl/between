import { createHash } from "node:crypto";
import { INITIAL_PROFILES, WENLI_SENDER_ID } from "../domain/contracts.js";
import { compareMessageCursors } from "../domain/contracts.js";
import { assertLegacyReadStateForward } from "../domain/read-state.js";
import { isHumanWenliMention } from "../domain/wenli-mention.js";
import type { WenliMentionOutbox } from "../ports/wenli-mention-outbox.js";
import { WenliPendingMentionInvalidError } from "../ports/wenli-mention-outbox.js";
import type {
  AccountId,
  AvatarObject,
  ContactRemarkRecord,
  Gender,
  ImageMimeType,
  MessageCursor,
  MessageRecord,
  MessageSenderId,
  MomentCommentRecord,
  MomentLikeRecord,
  MomentRecord,
  PetSessionRecord,
  PetStateRecord,
  PushRegistrationRecord,
  ReadStateRecord,
  RelationshipRecord,
  UserRecord
} from "../domain/contracts.js";
import type {
  AvatarStore,
  AdminAppendCollection,
  AdminStore,
  InitialProfilesFields,
  InitializeProfilesResult,
  LoginAttemptRecord,
  LoginAttemptStore,
  LoginFailurePolicy,
  ContactRemarkStore,
  ImageStorage,
  MessageStore,
  MessageAppendOptions,
  MomentStore,
  PetSessionStore,
  PetStateStore,
  PushRegistrationStore,
  ReadStateStore,
  ReleaseArtifactStore,
  RelationshipStore,
  SessionRotationFields,
  StoredDocument,
  UploadMetadata,
  UserStore
} from "../ports/stores.js";

export type DocumentData = Record<string, unknown>;

export interface CloudPersistence {
  getDocument(collection: string, id: string): Promise<DocumentData | null>;
  findOne(collection: string, equality: Record<string, unknown>): Promise<DocumentData | null>;
  putDocument(collection: string, id: string, data: DocumentData): Promise<void>;
  /** Must use the shared database transaction boundary, including expired-lock reset. */
  recordLoginFailure(id: string, policy: LoginFailurePolicy): Promise<LoginAttemptRecord>;
  removeDocument(collection: string, id: string): Promise<void>;
  putIfAbsent(collection: string, id: string, data: DocumentData): Promise<DocumentData>;
  putIfAbsentWithStatus(
    collection: string,
    id: string,
    data: DocumentData
  ): Promise<{ document: DocumentData; inserted: boolean }>;
  /** Production CloudBase implementation advances the receipt in a transaction. */
  advanceReadState?: (
    accountId: AccountId,
    cursor: MessageCursor,
    updatedAt: string
  ) => Promise<DocumentData>;
  /** Production CloudBase implementation merges legacy fields in a transaction. */
  patchReadState?: (
    accountId: AccountId,
    patch: DocumentData,
    updatedAt: string
  ) => Promise<DocumentData>;
  initializeUserProfilesIfNeeded(
    fields: InitialProfilesFields
  ): Promise<{ documents: DocumentData[] | null; initializedAccounts: AccountId[] }>;
  patchUserDocument(
    accountId: AccountId,
    fields: DocumentData,
    incrementSessionVersion: boolean
  ): Promise<DocumentData | null>;
  queryMessages(
    direction: "after" | "before",
    cursor: MessageCursor | null,
    limit: number
  ): Promise<DocumentData[]>;
  queryPendingWenliMentionIds(afterId: string | null, limit: number): Promise<string[]>;
  queryDueWenliAgentJobs(now: string, limit: number): Promise<DocumentData[]>;
  acknowledgeWenliMention(messageId: string): Promise<void>;
  queryLatestVisibleMoments(viewerId: AccountId, limit: number): Promise<DocumentData[]>;
  queryWenliMemories(limit: number): Promise<StoredDocument[]>;
  queryMomentRelations(
    collection: "momentLikes" | "momentComments",
    momentIds: string[],
    limit?: number
  ): Promise<DocumentData[]>;
  removeMomentRelations(momentId: string): Promise<void>;
  appendMomentRelationIfVisible(
    collection: "momentLikes" | "momentComments",
    relationId: string,
    momentId: string,
    actorId: AccountId,
    data: DocumentData
  ): Promise<DocumentData | null>;
  markMomentDeleting(momentId: string): Promise<void>;
  countDocuments(collection: string): Promise<number>;
  scanDocuments(collection: string, afterId: string | null, limit: number): Promise<StoredDocument[]>;
  upload(key: string, bytes: Uint8Array): Promise<string>;
  downloadFile(fileId: string): Promise<Uint8Array>;
  temporaryUrl(storedKey: string): Promise<string>;
  uploadMetadata(cloudPath: string): Promise<UploadMetadata>;
  temporaryFileUrl(fileId: string): Promise<string>;
}

export class CloudBaseUserStore implements UserStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async get(accountId: AccountId): Promise<UserRecord | null> {
    return toUser(await this.cloud.getDocument("users", accountId));
  }

  async findBySessionHash(sessionHash: string): Promise<UserRecord | null> {
    return toUser(await this.cloud.findOne("users", { sessionHash }));
  }

  async save(user: UserRecord): Promise<void> {
    await this.cloud.putDocument("users", user.accountId, { ...user });
  }

  async restoreIfAbsent(user: UserRecord): Promise<{ user: UserRecord; inserted: boolean }> {
    const result = await this.cloud.putIfAbsentWithStatus("users", user.accountId, { ...user });
    return { user: toUser(result.document)!, inserted: result.inserted };
  }

  async allAccountIds(): Promise<AccountId[]> {
    const records = await Promise.all([this.get("1001"), this.get("1002")]);
    return records.flatMap((record) => record ? [record.accountId] : []);
  }

  async initializeProfilesIfNeeded(fields: InitialProfilesFields): Promise<InitializeProfilesResult> {
    const result = await this.cloud.initializeUserProfilesIfNeeded(fields);
    if (!result.documents) return { users: null, initializedAccounts: result.initializedAccounts };
    return {
      users: result.documents.map((document) => toUser(document)!).filter(Boolean),
      initializedAccounts: result.initializedAccounts
    };
  }

  async rotateSession(accountId: AccountId, fields: SessionRotationFields): Promise<UserRecord | null> {
    return toUser(await this.cloud.patchUserDocument(accountId, { ...fields }, true));
  }

  async invalidateSession(accountId: AccountId, updatedAt: string): Promise<UserRecord | null> {
    return toUser(await this.cloud.patchUserDocument(accountId, { sessionHash: null, updatedAt }, true));
  }

  async updateDisplayName(accountId: AccountId, displayName: string, updatedAt: string): Promise<UserRecord | null> {
    return toUser(await this.cloud.patchUserDocument(accountId, { displayName, updatedAt }, false));
  }

  async updateAvatar(accountId: AccountId, avatarKey: string, updatedAt: string): Promise<UserRecord | null> {
    return toUser(await this.cloud.patchUserDocument(accountId, { avatarKey, updatedAt }, false));
  }
}

export class CloudBaseLoginAttemptStore implements LoginAttemptStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async get(accountId: AccountId, source: string): Promise<LoginAttemptRecord | null> {
    const document = await this.cloud.getDocument("login_attempts", attemptId(accountId, source));
    if (!document) return null;
    return {
      failures: numberValue(document.failures),
      blockedUntil: document.blockedUntil === null ? null : stringValue(document.blockedUntil)
    };
  }

  async save(accountId: AccountId, source: string, record: LoginAttemptRecord): Promise<void> {
    await this.cloud.putDocument("login_attempts", attemptId(accountId, source), { ...record });
  }

  async recordFailure(accountId: AccountId, source: string, policy: LoginFailurePolicy): Promise<LoginAttemptRecord> {
    return this.cloud.recordLoginFailure(attemptId(accountId, source), policy);
  }

  async clear(accountId: AccountId, source: string): Promise<void> {
    await this.cloud.removeDocument("login_attempts", attemptId(accountId, source));
  }
}

export class CloudBaseMessageStore implements MessageStore, WenliMentionOutbox {
  constructor(private readonly cloud: CloudPersistence) {}

  async appendIfAbsent(message: MessageRecord, options?: MessageAppendOptions): Promise<MessageRecord> {
    const { wenliMentionPending: _ignored, ...publicMessage } = message as MessageRecord & {
      wenliMentionPending?: unknown;
    };
    const capture = options?.captureWenliMention === true && isHumanWenliMention(publicMessage);
    return toMessage(await this.cloud.putIfAbsent("messages", publicMessage.id, {
      ...publicMessage,
      ...(capture ? { wenliMentionPending: true } : {})
    }));
  }

  async getPendingMention(messageId: string): Promise<MessageRecord | null> {
    const document = await this.cloud.getDocument("messages", messageId);
    if (document?.wenliMentionPending !== true) return null;
    try {
      const source = toMessage(document);
      if (source.id !== messageId || !isHumanWenliMention(source)) throw new Error();
      return source;
    } catch {
      throw new WenliPendingMentionInvalidError();
    }
  }

  async pendingMentionIds(afterId: string | null, limit: number): Promise<string[]> {
    return this.cloud.queryPendingWenliMentionIds(afterId, limit);
  }

  async acknowledgeMention(messageId: string): Promise<void> {
    await this.cloud.acknowledgeWenliMention(messageId);
  }

  async get(messageId: string): Promise<MessageRecord | null> {
    const document = await this.cloud.getDocument("messages", messageId);
    return document === null ? null : toMessage(document);
  }

  async after(cursor: MessageCursor | null, limit: number): Promise<MessageRecord[]> {
    return Promise.all((await this.cloud.queryMessages("after", cursor, limit)).map(toMessage));
  }

  async before(cursor: MessageCursor | null, limit: number): Promise<MessageRecord[]> {
    return Promise.all((await this.cloud.queryMessages("before", cursor, limit)).map(toMessage));
  }

  async count(): Promise<number> {
    return this.cloud.countDocuments("messages");
  }
}

export class CloudBaseContactRemarkStore implements ContactRemarkStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async get(ownerId: AccountId, targetId: AccountId): Promise<ContactRemarkRecord | null> {
    const document = await this.cloud.getDocument("contactRemarks", `${ownerId}_${targetId}`);
    if (document === null) return null;
    return {
      ownerId: accountValue(document.ownerId),
      targetId: accountValue(document.targetId),
      remark: stringValue(document.remark),
      updatedAt: stringValue(document.updatedAt)
    };
  }

  async upsert(record: ContactRemarkRecord): Promise<void> {
    await this.cloud.putDocument("contactRemarks", `${record.ownerId}_${record.targetId}`, { ...record });
  }
}

export class CloudBaseReadStateStore implements ReadStateStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async get(accountId: AccountId): Promise<ReadStateRecord | null> {
    const document = await this.cloud.getDocument("readStates", accountId);
    return document === null ? null : toReadState(document);
  }

  async save(record: ReadStateRecord): Promise<ReadStateRecord> {
    await this.cloud.putDocument("readStates", record.accountId, { ...record });
    return { ...record };
  }

  async patchLegacyReadState(
    accountId: AccountId,
    patch: Partial<Pick<ReadStateRecord, "lastReadMessageId" | "lastReadMessageCreatedAt" | "lastSeenMomentAt">>,
    updatedAt: string
  ): Promise<ReadStateRecord> {
    if (this.cloud.patchReadState) {
      return toReadState(await this.cloud.patchReadState(accountId, { ...patch }, updatedAt));
    }
    // Test/legacy adapters without the transaction primitive retain fields by
    // merging the latest document; production uses the atomic branch.
    const existing = await this.get(accountId);
    if (existing) assertLegacyReadStateForward(existing, patch);
    return this.save({ ...(existing ?? { accountId }), ...patch, updatedAt });
  }

  async advanceMessageReadReceipt(
    accountId: AccountId,
    cursor: MessageCursor,
    updatedAt: string
  ): Promise<ReadStateRecord> {
    if (this.cloud.advanceReadState) {
      return toReadState(await this.cloud.advanceReadState(accountId, cursor, updatedAt));
    }
    // Test/legacy persistence adapters without the transaction primitive retain
    // the same field-preserving behavior; production uses the atomic branch.
    const existing = await this.get(accountId);
    const existingCursor = existing?.readReceiptMessageId && existing.readReceiptMessageCreatedAt
      ? { id: existing.readReceiptMessageId, createdAt: existing.readReceiptMessageCreatedAt }
      : null;
    if (existingCursor && compareMessageCursors(cursor, existingCursor) <= 0) return existing!;
    return this.save({
      ...(existing ?? { accountId }),
      readReceiptMessageId: cursor.id,
      readReceiptMessageCreatedAt: cursor.createdAt,
      updatedAt
    });
  }
}

export class CloudBasePushRegistrationStore implements PushRegistrationStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async get(accountId: AccountId): Promise<PushRegistrationRecord | null> {
    const document = await this.cloud.getDocument("pushRegistrations", accountId);
    return document === null ? null : toPushRegistration(document);
  }

  async save(record: PushRegistrationRecord): Promise<PushRegistrationRecord> {
    await this.cloud.putDocument("pushRegistrations", record.accountId, { ...record });
    return { ...record };
  }

  async remove(accountId: AccountId): Promise<void> {
    await this.cloud.removeDocument("pushRegistrations", accountId);
  }
}

export class CloudBasePetSessionStore implements PetSessionStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async get(accountId: AccountId): Promise<PetSessionRecord | null> {
    const document = await this.cloud.getDocument("petSessions", accountId);
    return document === null ? null : toPetSession(document);
  }

  async save(record: PetSessionRecord): Promise<PetSessionRecord> {
    await this.cloud.putDocument("petSessions", record.accountId, { ...record });
    return { ...record };
  }

  async findBySessionHash(sessionHash: string): Promise<PetSessionRecord | null> {
    return toPetSession(await this.cloud.findOne("petSessions", { sessionHash }));
  }

  async remove(accountId: AccountId): Promise<void> {
    await this.cloud.removeDocument("petSessions", accountId);
  }
}

export class CloudBasePetStateStore implements PetStateStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async get(id: "couple"): Promise<PetStateRecord | null> {
    return toPetState(await this.cloud.getDocument("pet", id));
  }

  async save(record: PetStateRecord): Promise<PetStateRecord> {
    await this.cloud.putDocument("pet", record.id, { ...record });
    return { ...record };
  }
}

export class CloudBaseMomentStore implements MomentStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async appendMomentIfAbsent(moment: MomentRecord): Promise<MomentRecord> {
    return toMoment(await this.cloud.putIfAbsent("moments", moment.id, {
      ...moment,
      interactionVersion: 0
    }));
  }

  async getMoment(momentId: string): Promise<MomentRecord | null> {
    const document = await this.cloud.getDocument("moments", momentId);
    return document === null ? null : toMoment(document);
  }

  async latestVisibleMoments(viewerId: AccountId, limit: number): Promise<MomentRecord[]> {
    return (await this.cloud.queryLatestVisibleMoments(viewerId, limit)).map(toMoment);
  }

  async markDeleting(momentId: string): Promise<void> {
    await this.cloud.markMomentDeleting(momentId);
  }

  async removeMoment(momentId: string): Promise<void> {
    await this.cloud.removeDocument("moments", momentId);
  }

  async appendLikeToVisibleMomentIfAbsent(like: MomentLikeRecord): Promise<MomentLikeRecord | null> {
    const document = await this.cloud.appendMomentRelationIfVisible(
      "momentLikes",
      like.id,
      like.momentId,
      like.accountId,
      { ...like }
    );
    return document === null ? null : toMomentLike(document);
  }

  async removeLike(likeId: string): Promise<void> {
    await this.cloud.removeDocument("momentLikes", likeId);
  }

  async likesFor(momentIds: string[]): Promise<MomentLikeRecord[]> {
    return (await this.cloud.queryMomentRelations("momentLikes", momentIds))
      .map(toMomentLike)
      .sort(compareCreatedAtAndId);
  }

  async appendCommentToVisibleMomentIfAbsent(
    comment: MomentCommentRecord
  ): Promise<MomentCommentRecord | null> {
    const document = await this.cloud.appendMomentRelationIfVisible(
      "momentComments",
      comment.id,
      comment.momentId,
      comment.authorId,
      { ...comment }
    );
    return document === null ? null : toMomentComment(document);
  }

  async getComment(commentId: string): Promise<MomentCommentRecord | null> {
    const document = await this.cloud.getDocument("momentComments", commentId);
    return document === null ? null : toMomentComment(document);
  }

  async removeComment(commentId: string): Promise<void> {
    await this.cloud.removeDocument("momentComments", commentId);
  }

  async commentsFor(momentIds: string[]): Promise<MomentCommentRecord[]> {
    return (await this.cloud.queryMomentRelations("momentComments", momentIds))
      .map(toMomentComment)
      .sort(compareCreatedAtAndId);
  }

  async commentsForContext(momentIds: string[], limit: number): Promise<MomentCommentRecord[]> {
    return (await this.cloud.queryMomentRelations("momentComments", momentIds, limit))
      .map(toMomentComment)
      .sort(compareCreatedAtAndId);
  }

  async removeRelations(momentId: string): Promise<void> {
    await this.cloud.removeMomentRelations(momentId);
  }

}

export class CloudBaseAvatarStore implements AvatarStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async put(key: string, avatar: AvatarObject): Promise<string> {
    return this.cloud.upload(key, avatar.bytes);
  }

  async temporaryUrl(storedKey: string): Promise<string> {
    return this.cloud.temporaryUrl(storedKey);
  }
}

export class CloudBaseReleaseArtifactStore implements ReleaseArtifactStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async temporaryUrl(storedKey: string): Promise<string> {
    return this.cloud.temporaryUrl(storedKey);
  }
}

export class CloudBaseImageStorage implements ImageStorage {
  constructor(private readonly cloud: CloudPersistence) {}

  async uploadMetadata(cloudPath: string): Promise<UploadMetadata> {
    return this.cloud.uploadMetadata(cloudPath);
  }

  async temporaryFileUrl(fileId: string): Promise<string> {
    return this.cloud.temporaryFileUrl(fileId);
  }
}

export class CloudBaseRelationshipStore implements RelationshipStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async get(id: "couple"): Promise<RelationshipRecord | null> {
    return toRelationship(await this.cloud.getDocument("relationships", id));
  }

  async createIfAbsent(record: RelationshipRecord): Promise<{ record: RelationshipRecord; created: boolean }> {
    const existing = await this.get(record.id);
    if (existing) return { record: existing, created: false };
    const stored = toRelationship(await this.cloud.putIfAbsent("relationships", record.id, { ...record }));
    if (!stored) throw new Error("relationship write failed");
    return { record: stored, created: stored.createdAt === record.createdAt };
  }

  async count(): Promise<number> {
    return this.cloud.countDocuments("relationships");
  }
}

export class CloudBaseAdminStore implements AdminStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async exportPage(
    collection: AdminAppendCollection,
    afterId: string | null,
    limit: number
  ): Promise<{ entries: StoredDocument[]; nextCursor: string | null }> {
    const entries = await this.cloud.scanDocuments(collection, afterId, limit);
    return { entries, nextCursor: entries.at(-1)?.id ?? null };
  }

  async importMissing(collection: AdminAppendCollection, entries: StoredDocument[]): Promise<{ inserted: number }> {
    let inserted = 0;
    for (const entry of entries) {
      const existing = await this.cloud.getDocument(collection, entry.id);
      if (existing) continue;
      await this.cloud.putIfAbsent(collection, entry.id, entry.data);
      inserted += 1;
    }
    return { inserted };
  }
}

function attemptId(accountId: AccountId, source: string): string {
  return createHash("sha256").update(`${accountId}:${source}`).digest("hex");
}

function toUser(document: DocumentData | null): UserRecord | null {
  if (!document) return null;
  const accountId = stringValue(document.accountId);
  if (accountId !== "1001" && accountId !== "1002") throw new Error("invalid user document");
  return {
    accountId,
    displayName: stringValue(document.displayName),
    gender: genderValue(document.gender, accountId),
    avatarKey: nullableString(document.avatarKey),
    profileInitializedVersion: numberValueOr(document.profileInitializedVersion, 0),
    passwordHash: stringValue(document.passwordHash),
    sessionHash: nullableString(document.sessionHash),
    sessionVersion: numberValue(document.sessionVersion),
    updatedAt: stringValue(document.updatedAt)
  };
}

function toMessage(document: DocumentData): MessageRecord {
  const senderId = messageSenderValue(document.senderId);
  const recipientId = accountValue(document.recipientId);
  const replyToMessageId = document.replyToMessageId;
  if (replyToMessageId !== undefined && typeof replyToMessageId !== "string") {
    throw new Error("invalid message document");
  }
  const sourceMessageId = document.sourceMessageId === undefined
    ? undefined
    : humanMessageIdValue(document.sourceMessageId);
  if (senderId === WENLI_SENDER_ID) {
    if (sourceMessageId === undefined || replyToMessageId !== sourceMessageId) {
      throw new Error("invalid message document");
    }
  } else if (sourceMessageId !== undefined) {
    throw new Error("invalid message document");
  }
  const type = document.type === undefined ? undefined : messageTypeValue(document.type);
  const imageFileId = document.imageFileId === undefined ? undefined : stringValue(document.imageFileId);
  const imageMimeType = document.imageMimeType === undefined ? undefined : imageMimeTypeValue(document.imageMimeType);
  const imageWidth = document.imageWidth === undefined ? undefined : numberValue(document.imageWidth);
  const imageHeight = document.imageHeight === undefined ? undefined : numberValue(document.imageHeight);
  if (senderId === WENLI_SENDER_ID && (type === "image" || imageFileId !== undefined ||
    imageMimeType !== undefined || imageWidth !== undefined || imageHeight !== undefined)) {
    throw new Error("invalid message document");
  }
  return {
    id: stringValue(document.id),
    relationshipId: relationshipValue(document.relationshipId),
    senderId,
    recipientId,
    clientMessageId: stringValue(document.clientMessageId),
    body: stringValue(document.body),
    ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
    ...(sourceMessageId === undefined ? {} : { sourceMessageId }),
    ...(type === undefined ? {} : { type }),
    ...(imageFileId === undefined ? {} : { imageFileId }),
    ...(imageMimeType === undefined ? {} : { imageMimeType }),
    ...(imageWidth === undefined ? {} : { imageWidth }),
    ...(imageHeight === undefined ? {} : { imageHeight }),
    createdAt: stringValue(document.createdAt)
  };
}

function messageSenderValue(value: unknown): MessageSenderId {
  if (value === WENLI_SENDER_ID) return WENLI_SENDER_ID;
  if (value === "1001" || value === "1002") return value;
  throw new Error("Invalid message sender");
}

function humanMessageIdValue(value: unknown): string {
  const messageId = stringValue(value);
  const separator = messageId.indexOf("_");
  const senderId = messageId.slice(0, separator);
  const clientMessageId = messageId.slice(separator + 1);
  if ((senderId !== "1001" && senderId !== "1002") || !CLIENT_ID.test(clientMessageId)) {
    throw new Error("invalid message document");
  }
  return messageId;
}

function messageTypeValue(value: unknown): "text" | "image" {
  if (value !== "text" && value !== "image") throw new Error("invalid message document");
  return value;
}

function imageMimeTypeValue(value: unknown): ImageMimeType {
  if (value !== "image/jpeg" && value !== "image/png" && value !== "image/webp") {
    throw new Error("invalid message document");
  }
  return value;
}

const CLIENT_ID = /^[A-Za-z0-9_-]{1,100}$/;

function toMoment(document: DocumentData): MomentRecord {
  const authorId = accountValue(document.authorId);
  const clientMomentId = clientIdValue(document.clientMomentId, "invalid moment document");
  const id = stringValue(document.id);
  if (id !== `${authorId}_${clientMomentId}`) throw new Error("invalid moment document");
  if (document.visibility !== "PARTNER" && document.visibility !== "SELF") {
    throw new Error("invalid moment document");
  }
  if (typeof document.deleting !== "boolean") throw new Error("invalid moment document");
  interactionVersionValue(document.interactionVersion);
  const imageFileId = document.imageFileId === undefined ? undefined : stringValue(document.imageFileId);
  const imageMimeType = document.imageMimeType === undefined ? undefined : imageMimeTypeValue(document.imageMimeType);
  const imageWidth = document.imageWidth === undefined ? undefined : numberValue(document.imageWidth);
  const imageHeight = document.imageHeight === undefined ? undefined : numberValue(document.imageHeight);
  return {
    id,
    authorId,
    clientMomentId,
    body: stringValue(document.body),
    visibility: document.visibility,
    ...(imageFileId === undefined ? {} : { imageFileId }),
    ...(imageMimeType === undefined ? {} : { imageMimeType }),
    ...(imageWidth === undefined ? {} : { imageWidth }),
    ...(imageHeight === undefined ? {} : { imageHeight }),
    createdAt: isoTimestampValue(document.createdAt, "invalid moment document"),
    deleting: document.deleting
  };
}

function interactionVersionValue(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error("invalid moment document");
  }
  return value;
}

function toMomentLike(document: DocumentData): MomentLikeRecord {
  const momentId = momentIdValue(document.momentId, "invalid moment like document");
  const accountId = accountValue(document.accountId);
  const id = stringValue(document.id);
  if (id !== `${momentId}_${accountId}`) throw new Error("invalid moment like document");
  return {
    id,
    momentId,
    accountId,
    createdAt: isoTimestampValue(document.createdAt, "invalid moment like document")
  };
}

function toMomentComment(document: DocumentData): MomentCommentRecord {
  const momentId = momentIdValue(document.momentId, "invalid moment comment document");
  const authorId = accountValue(document.authorId);
  const clientCommentId = clientIdValue(document.clientCommentId, "invalid moment comment document");
  const id = stringValue(document.id);
  if (id !== `${authorId}_${clientCommentId}`) throw new Error("invalid moment comment document");
  return {
    id,
    momentId,
    authorId,
    clientCommentId,
    body: stringValue(document.body),
    ...(typeof document.replyToCommentId === "string" ? { replyToCommentId: document.replyToCommentId } : {}),
    createdAt: isoTimestampValue(document.createdAt, "invalid moment comment document")
  };
}

function toPushRegistration(document: DocumentData): PushRegistrationRecord {
  const accountId = accountValue(document.accountId);
  return {
    id: accountId,
    accountId,
    registrationId: stringValue(document.registrationId),
    platform: stringValue(document.platform),
    updatedAt: stringValue(document.updatedAt)
  };
}

function toPetSession(document: DocumentData | null): PetSessionRecord | null {
  if (!document) return null;
  const accountId = accountValue(document.accountId);
  return {
    id: accountId,
    accountId,
    sessionHash: stringValue(document.sessionHash),
    expiresAt: typeof document.expiresAt === "string"
      ? document.expiresAt
      : "1970-01-01T00:00:00.000Z",
    updatedAt: stringValue(document.updatedAt)
  };
}

function toPetState(document: DocumentData | null): PetStateRecord | null {
  if (!document) return null;
  if (document.id !== "couple") throw new Error("invalid pet state document");
  return {
    id: "couple",
    name: stringValue(document.name),
    host: stringValue(document.host),
    sex: document.sex === "母" ? "母" : "公",
    growth: numberValue(document.growth),
    hunger: numberValue(document.hunger),
    clean: numberValue(document.clean),
    health: numberValue(document.health),
    mood: numberValue(document.mood),
    yb: numberValue(document.yb),
    intel: numberValue(document.intel),
    charm: numberValue(document.charm),
    strong: numberValue(document.strong),
    birthDay: stringValue(document.birthDay),
    level: numberValue(document.level),
    updatedAt: stringValue(document.updatedAt),
    updatedBy: accountValue(document.updatedBy)
  };
}

function toReadState(document: DocumentData): ReadStateRecord {
  const accountId = accountValue(document.accountId);
  return {
    accountId,
    ...(typeof document.lastReadMessageId === "string" ? { lastReadMessageId: document.lastReadMessageId } : {}),
    ...(typeof document.lastReadMessageCreatedAt === "string"
      ? { lastReadMessageCreatedAt: document.lastReadMessageCreatedAt }
      : {}),
    ...(typeof document.readReceiptMessageId === "string" ? { readReceiptMessageId: document.readReceiptMessageId } : {}),
    ...(typeof document.readReceiptMessageCreatedAt === "string"
      ? { readReceiptMessageCreatedAt: document.readReceiptMessageCreatedAt }
      : {}),
    ...(typeof document.lastSeenMomentAt === "string" ? { lastSeenMomentAt: document.lastSeenMomentAt } : {}),
    updatedAt: stringValue(document.updatedAt)
  };
}

function toRelationship(document: DocumentData | null): RelationshipRecord | null {
  if (!document) return null;
  if (document.id !== "couple" || !Array.isArray(document.memberIds) ||
    document.memberIds[0] !== "1001" || document.memberIds[1] !== "1002") {
    throw new Error("invalid relationship document");
  }
  return { id: "couple", memberIds: ["1001", "1002"], createdAt: stringValue(document.createdAt) };
}

function relationshipValue(value: unknown): "couple" {
  if (value !== "couple") throw new Error("invalid relationship id");
  return value;
}

function accountValue(value: unknown): AccountId {
  const accountId = stringValue(value);
  if (accountId !== "1001" && accountId !== "1002") throw new Error("invalid account id");
  return accountId;
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid string field");
  return value;
}

function clientIdValue(value: unknown, message: string): string {
  const clientId = stringValue(value);
  if (!CLIENT_ID.test(clientId)) throw new Error(message);
  return clientId;
}

function momentIdValue(value: unknown, message: string): string {
  const momentId = stringValue(value);
  const separator = momentId.indexOf("_");
  if (separator < 0) throw new Error(message);
  const authorId = momentId.slice(0, separator);
  const clientMomentId = momentId.slice(separator + 1);
  if ((authorId !== "1001" && authorId !== "1002") || !CLIENT_ID.test(clientMomentId)) throw new Error(message);
  return momentId;
}

function isoTimestampValue(value: unknown, message: string): string {
  const timestamp = stringValue(value);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== timestamp) throw new Error(message);
  return timestamp;
}

function compareCreatedAtAndId(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function nullableString(value: unknown): string | null {
  return value === null ? null : stringValue(value);
}

function numberValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("invalid number field");
  return value;
}

function numberValueOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function genderValue(value: unknown, accountId: AccountId): Gender {
  return value === "女" || value === "男" ? value : INITIAL_PROFILES[accountId].gender;
}
