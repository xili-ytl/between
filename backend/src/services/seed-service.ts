import { INITIAL_PROFILES, type AccountId, type RelationshipRecord, type UserRecord } from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import type { RelationshipStore, UserStore } from "../ports/stores.js";
import { hashPassword } from "../security/password.js";

export interface SeedResult {
  createdAccounts: AccountId[];
  relationshipCreated: boolean;
}

export async function seedPrivateChat(
  users: UserStore,
  relationships: RelationshipStore,
  initialPassword: string,
  clock: () => Date = () => new Date()
): Promise<SeedResult> {
  const passwordLength = [...initialPassword].length;
  if (passwordLength < 4 || passwordLength > 128) {
    throw new AppError("SEED_INVALID", "初始密码长度须为 4 至 128 个字符");
  }

  const createdAccounts: AccountId[] = [];
  const now = clock().toISOString();
  for (const accountId of ["1001", "1002"] as const) {
    if (await users.get(accountId)) continue;
    const user: UserRecord = {
      accountId,
      ...INITIAL_PROFILES[accountId],
      avatarKey: null,
      profileInitializedVersion: 0,
      passwordHash: await hashPassword(initialPassword),
      sessionHash: null,
      sessionVersion: 0,
      updatedAt: now
    };
    await users.save(user);
    createdAccounts.push(accountId);
  }

  const relationship: RelationshipRecord = {
    id: "couple",
    memberIds: ["1001", "1002"],
    createdAt: now
  };
  const relationshipResult = await relationships.createIfAbsent(relationship);
  return { createdAccounts, relationshipCreated: relationshipResult.created };
}
