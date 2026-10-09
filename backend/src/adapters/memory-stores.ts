import { compareMessageCursors } from "../domain/contracts.js";
import { assertLegacyReadStateForward } from "../domain/read-state.js";
import type {
  AccountId,
  AvatarObject,
  ContactRemarkRecord,
  MessageCursor,
  MessageRecord,
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
import { FIXED_ACCOUNT_IDS } from "../domain/contracts.js";
import { isHumanWenliMention } from "../domain/wenli-mention.js";
import type { WenliMentionOutbox } from "../ports/wenli-mention-outbox.js";
import { WenliPendingMentionInvalidError } from "../ports/wenli-mention-outbox.js";
import type {
  AvatarStore,
  AdminAppendCollection,
  AdminStore,
  LoginAttemptRecord,
  LoginAttemptStore,
  ContactRemarkStore,
  ImageStorage,
  InitialProfilesFields,
  InitializeProfilesResult,
  MessageStore,
  MessageAppendOptions,
  MomentStore,
  PetSessionStore,
  PetStateStore,
  PushRegistrationStore,
  ReadStateStore,
  RelationshipStore,
  SessionRotationFields,
  StoredDocument,
  UploadMetadata,
  UserStore
} from "../ports/stores.js";

export class MemoryContactRemarkStore implements ContactRemarkStore {
  private readonly records = new Map<string, ContactRemarkRecord>();

  async get(ownerId: AccountId, targetId: AccountId): Promise<ContactRemarkRecord | null> {
    const record = this.records.get(`${ownerId}:${targetId}`);
    return record ? structuredClone(record) : null;
  }

  async upsert(record: ContactRemarkRecord): Promise<void> {
    this.records.set(`${record.ownerId}:${record.targetId}`, structuredClone(record));
  }
}

export class MemoryUserStore implements UserStore {
  private readonly records = new Map<AccountId, UserRecord>();

  async get(accountId: AccountId): Promise<UserRecord | null> {
    const record = this.records.get(accountId);
    return record ? structuredClone(record) : null;
  }

  async findBySessionHash(sessionHash: string): Promise<UserRecord | null> {
    const record = [...this.records.values()].find((candidate) => candidate.sessionHash === sessionHash);
    return record ? structuredClone(record) : null;
  }

  async save(user: UserRecord): Promise<void> {
    this.records.set(user.accountId, structuredClone(user));
  }

  async restoreIfAbsent(user: UserRecord): Promise<{ user: UserRecord; inserted: boolean }> {
    const existing = this.records.get(user.accountId);
    if (existing) return { user: structuredClone(existing), inserted: false };
    const restored = structuredClone(user);
    this.records.set(user.accountId, restored);
    return { user: structuredClone(restored), inserted: true };
  }

  async allAccountIds(): Promise<AccountId[]> {
    return [...this.records.keys()].sort();
  }

  async initializeProfilesIfNeeded(fields: InitialProfilesFields): Promise<InitializeProfilesResult> {
    const latest = FIXED_ACCOUNT_IDS.map((accountId) => this.records.get(accountId));
    if (latest.some((user) => !user)) return { users: null, initializedAccounts: [] };
    const initializedAccounts: AccountId[] = [];
    const users = FIXED_ACCOUNT_IDS.map((accountId, index) => {
      const user = latest[index]!;
      if (user.profileInitializedVersion >= 1) return user;
      initializedAccounts.push(accountId);
      return { ...user, ...fields[accountId], profileInitializedVersion: 1 };
    });
    for (const user of users) this.records.set(user.accountId, structuredClone(user));
    return { users: structuredClone(users), initializedAccounts };
  }

  async rotateSession(accountId: AccountId, fields: SessionRotationFields): Promise<UserRecord | null> {
    const latest = this.records.get(accountId);
    if (!latest) return null;
    const user = { ...latest, ...fields, sessionVersion: latest.sessionVersion + 1 };
    this.records.set(accountId, structuredClone(user));
    return structuredClone(user);
  }

  async invalidateSession(accountId: AccountId, updatedAt: string): Promise<UserRecord | null> {
    const latest = this.records.get(accountId);
    if (!latest) return null;
    const user = { ...latest, sessionHash: null, sessionVersion: latest.sessionVersion + 1, updatedAt };
    this.records.set(accountId, structuredClone(user));
    return structuredClone(user);
  }

  async updateDisplayName(accountId: AccountId, displayName: string, updatedAt: string): Promise<UserRecord | null> {
    return this.patch(accountId, { displayName, updatedAt });
  }

  async updateAvatar(accountId: AccountId, avatarKey: string, updatedAt: string): Promise<UserRecord | null> {
    return this.patch(accountId, { avatarKey, updatedAt });
  }

  private patch(accountId: AccountId, fields: Partial<UserRecord>): UserRecord | null {
    const latest = this.records.get(accountId);
    if (!latest) return null;
    const user = { ...latest, ...fields };
    this.records.set(accountId, structuredClone(user));
    return structuredClone(user);
  }
}

export class MemoryLoginAttemptStore implements LoginAttemptStore {
  private readonly records = new Map<string, LoginAttemptRecord>();

  async get(accountId: AccountId, source: string): Promise<LoginAttemptRecord | null> {
    const record = this.records.get(this.key(accountId, source));
    return record ? structuredClone(record) : null;
  }

  async save(accountId: AccountId, source: string, record: LoginAttemptRecord): Promise<void> {
    this.records.set(this.key(accountId, source), structuredClone(record));
  }

  async clear(accountId: AccountId, source: string): Promise<void> {
    this.records.delete(this.key(accountId, source));
  }

  private key(accountId: AccountId, source: string): string {
    return `${accountId}:${source}`;
  }
}

export class MemoryMessageStore implements MessageStore, WenliMentionOutbox {
  private readonly records = new Map<string, MessageRecord>();
  private readonly pendingMentions = new Set<string>();

  async appendIfAbsent(message: MessageRecord, options?: MessageAppendOptions): Promise<MessageRecord> {
    const existing = this.records.get(message.id);
    if (existing) {
      return structuredClone(existing!);
    }
    // Runtime input may contain extra properties; only the server option may capture intent.
    const { wenliMentionPending: _ignored, ...publicMessage } = message as MessageRecord & {
      wenliMentionPending?: unknown;
    };
    const stored = structuredClone(publicMessage);
    const capture = options?.captureWenliMention === true && isHumanWenliMention(stored);
    // No await between insertion and capture: duplicates cannot add or re-arm an intent.
    this.records.set(stored.id, stored);
    if (capture) this.pendingMentions.add(stored.id);
    return structuredClone(stored);
  }

  async getPendingMention(messageId: string): Promise<MessageRecord | null> {
    if (!this.pendingMentions.has(messageId)) return null;
    const message = this.records.get(messageId);
    if (!message || message.id !== messageId || !isHumanWenliMention(message)) {
      throw new WenliPendingMentionInvalidError();
    }
    return structuredClone(message);
  }

  async pendingMentionIds(afterId: string | null, limit: number): Promise<string[]> {
    return [...this.pendingMentions].filter((id) => afterId === null || id > afterId).sort().slice(0, limit);
  }

  async acknowledgeMention(messageId: string): Promise<void> {
    this.pendingMentions.delete(messageId);
  }

  async get(messageId: string): Promise<MessageRecord | null> {
    const message = this.records.get(messageId);
    return message ? structuredClone(message) : null;
  }

  async after(cursor: MessageCursor | null, limit: number): Promise<MessageRecord[]> {
    return this.sorted()
      .filter((message) => cursor === null || compareMessageToCursor(message, cursor) > 0)
      .slice(0, limit)
      .map((message) => structuredClone(message));
  }

  async before(cursor: MessageCursor | null, limit: number): Promise<MessageRecord[]> {
    return this.sorted()
      .filter((message) => cursor === null || compareMessageToCursor(message, cursor) < 0)
      .reverse()
      .slice(0, limit)
      .map((message) => structuredClone(message));
  }

  async count(): Promise<number> {
    return this.records.size;
  }

  private sorted(): MessageRecord[] {
    return [...this.records.values()].sort(compareMessages);
  }
}

export class MemoryMomentStore implements MomentStore {
  private readonly moments = new Map<string, MomentRecord>();
  private readonly likes = new Map<string, MomentLikeRecord>();
  private readonly comments = new Map<string, MomentCommentRecord>();

  async appendMomentIfAbsent(moment: MomentRecord): Promise<MomentRecord> {
    const existing = this.moments.get(moment.id);
    if (existing) return structuredClone(existing);
    this.moments.set(moment.id, structuredClone(moment));
    return structuredClone(moment);
  }

  async getMoment(momentId: string): Promise<MomentRecord | null> {
    const moment = this.moments.get(momentId);
    return moment ? structuredClone(moment) : null;
  }

  async latestVisibleMoments(viewerId: AccountId, limit: number): Promise<MomentRecord[]> {
    return [...this.moments.values()]
      .filter((moment) => !moment.deleting && (moment.visibility === "PARTNER" || moment.authorId === viewerId))
      .sort((left, right) => compareCreatedAtAndId(right, left))
      .slice(0, limit)
      .map((moment) => structuredClone(moment));
  }

  async markDeleting(momentId: string): Promise<void> {
    const existing = this.moments.get(momentId);
    if (!existing) return;
    const deleting = { ...existing, deleting: true };
    this.moments.set(momentId, structuredClone(deleting));
  }

  async removeMoment(momentId: string): Promise<void> {
    this.moments.delete(momentId);
  }

  async appendLikeToVisibleMomentIfAbsent(like: MomentLikeRecord): Promise<MomentLikeRecord | null> {
    const moment = this.moments.get(like.momentId);
    if (!moment || moment.deleting || !isMomentVisibleTo(like.accountId, moment)) return null;
    const existing = this.likes.get(like.id);
    if (existing) return structuredClone(existing);
    this.likes.set(like.id, structuredClone(like));
    return structuredClone(like);
  }

  async removeLike(likeId: string): Promise<void> {
    this.likes.delete(likeId);
  }

  async likesFor(momentIds: string[]): Promise<MomentLikeRecord[]> {
    const requested = new Set(momentIds);
    return [...this.likes.values()]
      .filter((like) => requested.has(like.momentId))
      .sort(compareCreatedAtAndId)
      .map((like) => structuredClone(like));
  }

  async appendCommentToVisibleMomentIfAbsent(comment: MomentCommentRecord): Promise<MomentCommentRecord | null> {
    const moment = this.moments.get(comment.momentId);
    if (!moment || moment.deleting || !isMomentVisibleTo(comment.authorId, moment)) return null;
    const existing = this.comments.get(comment.id);
    if (existing) return structuredClone(existing);
    this.comments.set(comment.id, structuredClone(comment));
    return structuredClone(comment);
  }

  async getComment(commentId: string): Promise<MomentCommentRecord | null> {
    const comment = this.comments.get(commentId);
    return comment ? structuredClone(comment) : null;
  }

  async removeComment(commentId: string): Promise<void> {
    this.comments.delete(commentId);
  }

  async commentsFor(momentIds: string[]): Promise<MomentCommentRecord[]> {
    const requested = new Set(momentIds);
    return [...this.comments.values()]
      .filter((comment) => requested.has(comment.momentId))
      .sort(compareCreatedAtAndId)
      .map((comment) => structuredClone(comment));
  }

  async commentsForContext(momentIds: string[], limit: number): Promise<MomentCommentRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid comment context limit");
    return (await this.commentsFor(momentIds)).slice(-limit);
  }

  async removeRelations(momentId: string): Promise<void> {
    for (const [id, like] of this.likes) {
      if (like.momentId === momentId) this.likes.delete(id);
    }
    for (const [id, comment] of this.comments) {
      if (comment.momentId === momentId) this.comments.delete(id);
    }
  }
}

export class MemoryImageStorage implements ImageStorage {
  async uploadMetadata(cloudPath: string): Promise<UploadMetadata> {
    return {
      uploadUrl: `memory-upload://${cloudPath}`,
      authorization: "memory-authorization",
      token: "memory-token",
      cosFileId: "memory-cos-file-id",
      fileId: `cloud://memory-bucket/${cloudPath}`
    };
  }

  async temporaryFileUrl(fileId: string): Promise<string> {
    return `memory://${fileId}`;
  }
}

export class MemoryAvatarStore implements AvatarStore {
  private readonly records = new Map<string, AvatarObject>();

  async put(key: string, avatar: AvatarObject): Promise<string> {
    this.records.set(key, structuredClone(avatar));
    return key;
  }

  async temporaryUrl(storedKey: string): Promise<string> {
    return `memory://${storedKey}`;
  }

  async get(key: string): Promise<AvatarObject | null> {
    const avatar = this.records.get(key);
    return avatar ? structuredClone(avatar) : null;
  }
}

export class MemoryRelationshipStore implements RelationshipStore {
  private record: RelationshipRecord | null = null;

  async get(id: "couple"): Promise<RelationshipRecord | null> {
    return this.record?.id === id ? structuredClone(this.record) : null;
  }

  async createIfAbsent(record: RelationshipRecord): Promise<{ record: RelationshipRecord; created: boolean }> {
    if (this.record) return { record: structuredClone(this.record), created: false };
    this.record = structuredClone(record);
    return { record: structuredClone(record), created: true };
  }

  async count(): Promise<number> {
    return this.record ? 1 : 0;
  }
}

export class MemoryReadStateStore implements ReadStateStore {
  private readonly records = new Map<AccountId, ReadStateRecord>();

  async get(accountId: AccountId): Promise<ReadStateRecord | null> {
    const record = this.records.get(accountId);
    return record ? structuredClone(record) : null;
  }

  async save(record: ReadStateRecord): Promise<ReadStateRecord> {
    this.records.set(record.accountId, structuredClone(record));
    return structuredClone(record);
  }

  async patchLegacyReadState(
    accountId: AccountId,
    patch: Partial<Pick<ReadStateRecord, "lastReadMessageId" | "lastReadMessageCreatedAt" | "lastSeenMomentAt">>,
    updatedAt: string
  ): Promise<ReadStateRecord> {
    const existing = this.records.get(accountId);
    if (existing) assertLegacyReadStateForward(existing, patch);
    const record: ReadStateRecord = {
      ...(existing ?? { accountId }),
      ...patch,
      updatedAt
    };
    this.records.set(accountId, structuredClone(record));
    return structuredClone(record);
  }

  async advanceMessageReadReceipt(
    accountId: AccountId,
    cursor: MessageCursor,
    updatedAt: string
  ): Promise<ReadStateRecord> {
    const existing = this.records.get(accountId);
    const existingCursor = existing?.readReceiptMessageId && existing.readReceiptMessageCreatedAt
      ? { id: existing.readReceiptMessageId, createdAt: existing.readReceiptMessageCreatedAt }
      : null;
    if (existingCursor && compareMessageCursors(cursor, existingCursor) <= 0) {
      return structuredClone(existing!);
    }
    const record: ReadStateRecord = {
      ...(existing ?? { accountId }),
      readReceiptMessageId: cursor.id,
      readReceiptMessageCreatedAt: cursor.createdAt,
      updatedAt
    };
    this.records.set(accountId, structuredClone(record));
    return structuredClone(record);
  }
}

export class MemoryPushRegistrationStore implements PushRegistrationStore {
  private readonly records = new Map<AccountId, PushRegistrationRecord>();

  async get(accountId: AccountId): Promise<PushRegistrationRecord | null> {
    const record = this.records.get(accountId);
    return record ? structuredClone(record) : null;
  }

  async save(record: PushRegistrationRecord): Promise<PushRegistrationRecord> {
    this.records.set(record.accountId, structuredClone(record));
    return structuredClone(record);
  }

  async remove(accountId: AccountId): Promise<void> {
    this.records.delete(accountId);
  }
}

export class MemoryPetSessionStore implements PetSessionStore {
  private readonly records = new Map<AccountId, PetSessionRecord>();

  async get(accountId: AccountId): Promise<PetSessionRecord | null> {
    const record = this.records.get(accountId);
    return record ? structuredClone(record) : null;
  }

  async save(record: PetSessionRecord): Promise<PetSessionRecord> {
    this.records.set(record.accountId, structuredClone(record));
    return structuredClone(record);
  }

  async findBySessionHash(sessionHash: string): Promise<PetSessionRecord | null> {
    const record = [...this.records.values()].find((candidate) => candidate.sessionHash === sessionHash);
    return record ? structuredClone(record) : null;
  }

  async remove(accountId: AccountId): Promise<void> {
    this.records.delete(accountId);
  }
}

export class MemoryPetStateStore implements PetStateStore {
  private record: PetStateRecord | null = null;

  async get(id: "couple"): Promise<PetStateRecord | null> {
    return this.record?.id === id ? structuredClone(this.record) : null;
  }

  async save(record: PetStateRecord): Promise<PetStateRecord> {
    this.record = structuredClone(record);
    return structuredClone(record);
  }
}

export class MemoryAdminStore implements AdminStore {
  private readonly collections = new Map<AdminAppendCollection, Map<string, Record<string, unknown>>>();

  async exportPage(
    collection: AdminAppendCollection,
    afterId: string | null,
    limit: number
  ): Promise<{ entries: StoredDocument[]; nextCursor: string | null }> {
    const entries = [...this.collection(collection).entries()]
      .filter(([id]) => afterId === null || id > afterId)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, limit)
      .map(([id, data]) => ({ id, data: structuredClone(data) }));
    return { entries, nextCursor: entries.at(-1)?.id ?? null };
  }

  async importMissing(
    collection: AdminAppendCollection,
    entries: StoredDocument[]
  ): Promise<{ inserted: number }> {
    const records = this.collection(collection);
    let inserted = 0;
    for (const entry of entries) {
      if (records.has(entry.id)) continue;
      records.set(entry.id, structuredClone(entry.data));
      inserted += 1;
    }
    return { inserted };
  }

  private collection(name: AdminAppendCollection): Map<string, Record<string, unknown>> {
    const existing = this.collections.get(name);
    if (existing) return existing;
    const created = new Map<string, Record<string, unknown>>();
    this.collections.set(name, created);
    return created;
  }
}

function compareMessages(left: MessageRecord, right: MessageRecord): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function compareMessageToCursor(message: MessageRecord, cursor: MessageCursor): number {
  return message.createdAt.localeCompare(cursor.createdAt) || message.id.localeCompare(cursor.id);
}

function compareCreatedAtAndId(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function isMomentVisibleTo(viewerId: AccountId, moment: MomentRecord): boolean {
  return moment.visibility === "PARTNER" || moment.authorId === viewerId;
}
