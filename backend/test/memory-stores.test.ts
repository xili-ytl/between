import { describe, expect, it } from "vitest";
import { MemoryUserStore } from "../src/adapters/memory-stores.js";
import { INITIAL_PROFILES, type UserRecord } from "../src/domain/contracts.js";

describe("MemoryUserStore", () => {
  it("atomically initializes both profiles once while preserving the latest security fields", async () => {
    const users = new MemoryUserStore();
    await users.save(user({
      passwordHash: "latest-password-hash",
      sessionHash: "latest-session-hash",
      sessionVersion: 9
    }));
    await users.save(user({ accountId: "1002", ...INITIAL_PROFILES["1002"] }));
    const fields = initialFields();

    const results = await Promise.all([
      users.initializeProfilesIfNeeded(fields),
      users.initializeProfilesIfNeeded(fields)
    ]);

    expect(results.flatMap((result) => result.initializedAccounts)).toEqual(["1001", "1002"]);
    await expect(users.get("1001")).resolves.toMatchObject({
      ...fields["1001"],
      profileInitializedVersion: 1,
      passwordHash: "latest-password-hash",
      sessionHash: "latest-session-hash",
      sessionVersion: 9
    });
  });

  it("applies only scoped auth and profile patches to the latest record", async () => {
    const users = new MemoryUserStore();
    await users.save(user());
    await users.save(user({ accountId: "1002", ...INITIAL_PROFILES["1002"] }));
    await users.initializeProfilesIfNeeded(initialFields());

    await users.rotateSession("1001", {
      sessionHash: "new-session",
      updatedAt: "session-time",
      passwordHash: "new-password-hash"
    });
    await users.updateDisplayName("1001", "chosen name", "profile-time");
    await users.updateAvatar("1001", "avatars/1001/current.png", "avatar-time");

    await expect(users.get("1001")).resolves.toMatchObject({
      displayName: "chosen name",
      gender: INITIAL_PROFILES["1001"].gender,
      avatarKey: "avatars/1001/current.png",
      profileInitializedVersion: 1,
      passwordHash: "new-password-hash",
      sessionHash: "new-session",
      sessionVersion: 1
    });
  });
});

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    accountId: "1001",
    ...INITIAL_PROFILES["1001"],
    avatarKey: null,
    profileInitializedVersion: 0,
    passwordHash: "password-hash",
    sessionHash: null,
    sessionVersion: 0,
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides
  };
}

function initialFields() {
  return {
    "1001": {
      ...INITIAL_PROFILES["1001"],
      avatarKey: "avatars/1001/initial.jpg",
      updatedAt: "2026-08-07T08:09:10.000Z"
    },
    "1002": {
      ...INITIAL_PROFILES["1002"],
      avatarKey: "avatars/1002/initial.jpg",
      updatedAt: "2026-08-07T08:09:10.000Z"
    }
  };
}
