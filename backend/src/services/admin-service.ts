import { createHash, timingSafeEqual } from "node:crypto";
import { FIXED_ACCOUNT_IDS, INITIAL_PROFILES } from "../domain/contracts.js";
import type {
  AccountId,
  AvatarObject
} from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import {
  canonicalizeBackupEntry,
  canonicalizeRelationshipEntry,
  canonicalizeUserEntry
} from "../backup/backup-validator.js";
import type { BackupCollection } from "../backup/backup-validator.js";
import type {
  AdminAppendCollection,
  AdminStore,
  AvatarStore,
  RelationshipStore,
  StoredDocument,
  UserStore
} from "../ports/stores.js";
import { seedPrivateChat, type SeedResult } from "./seed-service.js";

export type { BackupCollection } from "../backup/backup-validator.js";
const MAX_INITIAL_AVATAR_BYTES = 512 * 1024;
const INITIAL_AVATAR_SHA256: Record<AccountId, string> = {
  "1001": "cb3811c1599a9871648272ceaaa21982c7e92deabc367facea3a6941e9804a9b",
  "1002": "b879f70cac2dca989da9691b445cdd5e0370bf1274e7ec00e66a827614d65928"
};

export class AdminService {
  constructor(
    private readonly secret: string,
    private readonly users: UserStore,
    private readonly relationships: RelationshipStore,
    private readonly backups: AdminStore,
    private readonly avatars: AvatarStore,
    private readonly clock: () => Date
  ) {}

  async seed(token: string, initialPassword: string): Promise<SeedResult> {
    this.authorize(token);
    return seedPrivateChat(this.users, this.relationships, initialPassword);
  }

  async initializeProfiles(
    token: string,
    avatars: Record<AccountId, AvatarObject>
  ): Promise<{ initializedAccounts: AccountId[] }> {
    this.authorize(token);
    const users = await Promise.all(FIXED_ACCOUNT_IDS.map((accountId) => this.users.get(accountId)));

    for (const user of users) {
      if (!user) throw new AppError("USER_NOT_FOUND", "账号不存在");
    }
    for (const accountId of FIXED_ACCOUNT_IDS) {
      assertInitialAvatar(accountId, avatars[accountId]);
    }

    const avatar1001Key = await this.avatars.put("avatars/1001/initial.jpg", avatars["1001"]);
    const avatar1002Key = await this.avatars.put("avatars/1002/initial.jpg", avatars["1002"]);
    const result = await this.users.initializeProfilesIfNeeded({
      "1001": {
        ...INITIAL_PROFILES["1001"],
        avatarKey: avatar1001Key,
        updatedAt: this.clock().toISOString()
      },
      "1002": {
        ...INITIAL_PROFILES["1002"],
        avatarKey: avatar1002Key,
        updatedAt: this.clock().toISOString()
      }
    });
    if (!result.users) throw new AppError("USER_NOT_FOUND", "账号不存在");
    return { initializedAccounts: result.initializedAccounts };
  }

  async exportPage(
    token: string,
    collection: string,
    afterId: string | null,
    limit: number
  ): Promise<{ entries: StoredDocument[]; nextCursor: string | null }> {
    this.authorize(token);
    const selected = collectionValue(collection);
    assertPage(limit);
    if (isAppendCollection(selected)) {
      const result = await this.backups.exportPage(selected, afterId, limit);
      return {
        entries: result.entries.map((entry) => adminEntry(selected, entry)),
        nextCursor: result.nextCursor
      };
    }

    const entries = selected === "users"
      ? await this.userEntries()
      : await this.relationshipEntries();
    const page = entries.filter((entry) => afterId === null || entry.id > afterId).slice(0, limit);
    return { entries: page, nextCursor: page.at(-1)?.id ?? null };
  }

  async importMissingPage(
    token: string,
    collection: string,
    entries: StoredDocument[]
  ): Promise<{ attempted: number; inserted: number }> {
    this.authorize(token);
    const selected = collectionValue(collection);
    if (entries.length > 500) throw new AppError("ADMIN_PAGE_INVALID", "每页最多 500 条记录");

    let inserted = 0;
    if (isAppendCollection(selected)) {
      const validated = entries.map((entry) => adminEntry(selected, entry));
      inserted = (await this.backups.importMissing(selected, validated)).inserted;
    } else if (selected === "users") {
      const validatedUsers = entries.map((entry) => adminUserEntry(entry).data);
      for (const user of validatedUsers) {
        const result = await this.users.restoreIfAbsent(user);
        if (result.inserted) inserted += 1;
      }
    } else {
      const validatedRelationships = entries.map((entry) => adminRelationshipEntry(entry).data);
      for (const relationship of validatedRelationships) {
        const result = await this.relationships.createIfAbsent(relationship);
        if (result.created) inserted += 1;
      }
    }
    return { attempted: entries.length, inserted };
  }

  authorize(token: string): void {
    if (!this.secret || !constantTimeEqual(token, this.secret)) {
      throw new AppError("ADMIN_UNAUTHORIZED", "管理操作未授权");
    }
  }

  private async userEntries(): Promise<StoredDocument[]> {
    const records = await Promise.all([this.users.get("1001"), this.users.get("1002")]);
    return records.flatMap((user) => user ? [{ id: user.accountId, data: { ...user } }] : []);
  }

  private async relationshipEntries(): Promise<StoredDocument[]> {
    const relationship = await this.relationships.get("couple");
    return relationship ? [{ id: relationship.id, data: { ...relationship } }] : [];
  }
}

function assertInitialAvatar(accountId: AccountId, avatar: AvatarObject | undefined): asserts avatar is AvatarObject {
  if (!avatar || avatar.contentType !== "image/jpeg" || !(avatar.bytes instanceof Uint8Array) ||
    avatar.bytes.byteLength < 1 || avatar.bytes.byteLength > MAX_INITIAL_AVATAR_BYTES ||
    createHash("sha256").update(avatar.bytes).digest("hex") !== INITIAL_AVATAR_SHA256[accountId]) {
    throw new AppError("AVATAR_INVALID", "初始头像与指定 JPEG 文件不匹配");
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function collectionValue(value: string): BackupCollection {
  if (
    value === "users" || value === "relationships" || value === "messages" ||
    value === "moments" || value === "momentLikes" || value === "momentComments" ||
    value === "readStates" || value === "wenliAgentJobs" || value === "wenliMemories"
  ) return value;
  throw new AppError("ADMIN_COLLECTION_INVALID", "备份集合无效");
}

function isAppendCollection(value: BackupCollection): value is AdminAppendCollection {
  return value === "messages" || value === "moments" ||
    value === "momentLikes" || value === "momentComments" || value === "readStates" ||
    value === "wenliAgentJobs" || value === "wenliMemories";
}

function assertPage(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new AppError("ADMIN_PAGE_INVALID", "每页记录数须为 1 至 500");
  }
}

function adminEntry(collection: AdminAppendCollection, entry: StoredDocument): StoredDocument {
  return adminDocument(() => canonicalizeBackupEntry(collection, entry));
}

function adminUserEntry(entry: StoredDocument) {
  return adminDocument(() => canonicalizeUserEntry(entry));
}

function adminRelationshipEntry(entry: StoredDocument) {
  return adminDocument(() => canonicalizeRelationshipEntry(entry));
}

function adminDocument<T>(validate: () => T): T {
  try {
    return validate();
  } catch (error) {
    if (error instanceof AppError && error.code === "BACKUP_FORMAT_INVALID") {
      throw new AppError("ADMIN_DOCUMENT_INVALID", "备份记录无效");
    }
    throw error;
  }
}
