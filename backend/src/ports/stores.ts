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

export interface LoginAttemptRecord {
  failures: number;
  blockedUntil: string | null;
}

export interface LoginFailurePolicy {
  now: string;
  maxFailures: number;
  blockMilliseconds: number;
}

export type InitialProfileFields = Pick<
  UserRecord,
  "displayName" | "gender" | "avatarKey" | "updatedAt"
>;

export type InitialProfilesFields = Record<AccountId, InitialProfileFields>;

export interface InitializeProfilesResult {
  users: UserRecord[] | null;
  initializedAccounts: AccountId[];
}

export interface SessionRotationFields {
  sessionHash: string;
  updatedAt: string;
  passwordHash?: string;
}

export interface UserStore {
  get(accountId: AccountId): Promise<UserRecord | null>;
  findBySessionHash(sessionHash: string): Promise<UserRecord | null>;
  save(user: UserRecord): Promise<void>;
  restoreIfAbsent(user: UserRecord): Promise<{ user: UserRecord; inserted: boolean }>;
  allAccountIds(): Promise<AccountId[]>;
  initializeProfilesIfNeeded(fields: InitialProfilesFields): Promise<InitializeProfilesResult>;
  rotateSession(accountId: AccountId, fields: SessionRotationFields): Promise<UserRecord | null>;
  invalidateSession(accountId: AccountId, updatedAt: string): Promise<UserRecord | null>;
  updateDisplayName(accountId: AccountId, displayName: string, updatedAt: string): Promise<UserRecord | null>;
  updateAvatar(accountId: AccountId, avatarKey: string, updatedAt: string): Promise<UserRecord | null>;
}

export interface LoginAttemptStore {
  get(accountId: AccountId, source: string): Promise<LoginAttemptRecord | null>;
  /** Read the latest count, reset expired locks, and record a failure in one atomic operation. */
  recordFailure(accountId: AccountId, source: string, policy: LoginFailurePolicy): Promise<LoginAttemptRecord>;
  save(accountId: AccountId, source: string, record: LoginAttemptRecord): Promise<void>;
  clear(accountId: AccountId, source: string): Promise<void>;
}

export interface MessageAppendOptions {
  captureWenliMention?: boolean;
}

export interface MessageStore {
  appendIfAbsent(message: MessageRecord, options?: MessageAppendOptions): Promise<MessageRecord>;
  get(messageId: string): Promise<MessageRecord | null>;
  after(cursor: MessageCursor | null, limit: number): Promise<MessageRecord[]>;
  before(cursor: MessageCursor | null, limit: number): Promise<MessageRecord[]>;
  count(): Promise<number>;
}

export interface ContactRemarkStore {
  get(ownerId: AccountId, targetId: AccountId): Promise<ContactRemarkRecord | null>;
  upsert(record: ContactRemarkRecord): Promise<void>;
}

export interface MomentStore {
  appendMomentIfAbsent(moment: MomentRecord): Promise<MomentRecord>;
  getMoment(momentId: string): Promise<MomentRecord | null>;
  latestVisibleMoments(viewerId: AccountId, limit: number): Promise<MomentRecord[]>;
  markDeleting(momentId: string): Promise<void>;
  removeMoment(momentId: string): Promise<void>;
  /** Cloud implementations must check visibility/deleting state and insert or read the like in one transaction. */
  appendLikeToVisibleMomentIfAbsent(like: MomentLikeRecord): Promise<MomentLikeRecord | null>;
  removeLike(likeId: string): Promise<void>;
  likesFor(momentIds: string[]): Promise<MomentLikeRecord[]>;
  /** Cloud implementations must check visibility/deleting state and insert or read the comment in one transaction. */
  appendCommentToVisibleMomentIfAbsent(comment: MomentCommentRecord): Promise<MomentCommentRecord | null>;
  getComment(commentId: string): Promise<MomentCommentRecord | null>;
  removeComment(commentId: string): Promise<void>;
  commentsFor(momentIds: string[]): Promise<MomentCommentRecord[]>;
  /** Recent, bounded context for Wenli; never paginate the entire comment thread. */
  commentsForContext?(momentIds: string[], limit: number): Promise<MomentCommentRecord[]>;
  removeRelations(momentId: string): Promise<void>;
}

export interface AvatarStore {
  put(key: string, avatar: AvatarObject): Promise<string>;
  temporaryUrl(storedKey: string): Promise<string>;
}

export interface ReleaseArtifactStore {
  temporaryUrl(storedKey: string): Promise<string>;
}

export interface UploadMetadata {
  uploadUrl: string;
  authorization: string;
  token: string;
  cosFileId: string;
  fileId: string;
}

export interface ImageStorage {
  uploadMetadata(cloudPath: string): Promise<UploadMetadata>;
  temporaryFileUrl(fileId: string): Promise<string>;
}

export interface RelationshipStore {
  get(id: "couple"): Promise<RelationshipRecord | null>;
  createIfAbsent(record: RelationshipRecord): Promise<{ record: RelationshipRecord; created: boolean }>;
  count(): Promise<number>;
}

export interface ReadStateStore {
  get(accountId: AccountId): Promise<ReadStateRecord | null>;
  save(record: ReadStateRecord): Promise<ReadStateRecord>;
  patchLegacyReadState(
    accountId: AccountId,
    patch: Partial<Pick<ReadStateRecord, "lastReadMessageId" | "lastReadMessageCreatedAt" | "lastSeenMomentAt">>,
    updatedAt: string
  ): Promise<ReadStateRecord>;
  advanceMessageReadReceipt(
    accountId: AccountId,
    cursor: MessageCursor,
    updatedAt: string
  ): Promise<ReadStateRecord>;
}

export interface PushRegistrationStore {
  get(accountId: AccountId): Promise<PushRegistrationRecord | null>;
  save(record: PushRegistrationRecord): Promise<PushRegistrationRecord>;
  remove(accountId: AccountId): Promise<void>;
}

export interface PetSessionStore {
  get(accountId: AccountId): Promise<PetSessionRecord | null>;
  save(record: PetSessionRecord): Promise<PetSessionRecord>;
  findBySessionHash(sessionHash: string): Promise<PetSessionRecord | null>;
  remove(accountId: AccountId): Promise<void>;
}

export interface PetStateStore {
  get(id: "couple"): Promise<PetStateRecord | null>;
  save(record: PetStateRecord): Promise<PetStateRecord>;
}

export interface StoredDocument {
  id: string;
  data: Record<string, unknown>;
}

export type AdminAppendCollection =
  | "messages"
  | "moments"
  | "momentLikes"
  | "momentComments"
  | "readStates"
  | "wenliAgentJobs"
  | "wenliMemories";

export interface AdminStore {
  exportPage(collection: AdminAppendCollection, afterId: string | null, limit: number): Promise<{
    entries: StoredDocument[];
    nextCursor: string | null;
  }>;
  importMissing(collection: AdminAppendCollection, entries: StoredDocument[]): Promise<{ inserted: number }>;
}
