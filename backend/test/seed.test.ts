import { describe, expect, it } from "vitest";
import { MemoryRelationshipStore, MemoryUserStore } from "../src/adapters/memory-stores.js";
import { verifyPassword } from "../src/security/password.js";
import { seedPrivateChat } from "../src/services/seed-service.js";

describe("seedPrivateChat", () => {
  it("creates exactly the two fixed accounts and relationship idempotently", async () => {
    const users = new MemoryUserStore();
    const relationships = new MemoryRelationshipStore();

    const first = await seedPrivateChat(users, relationships, "1013", () => new Date("2026-08-06T00:00:00.000Z"));
    const second = await seedPrivateChat(users, relationships, "different-password", () => new Date("2026-08-07T00:00:00.000Z"));

    expect(first).toEqual({ createdAccounts: ["1001", "1002"], relationshipCreated: true });
    expect(second).toEqual({ createdAccounts: [], relationshipCreated: false });
    expect(await users.allAccountIds()).toEqual(["1001", "1002"]);
    expect(await relationships.count()).toBe(1);
    expect(await relationships.get("couple")).toEqual({
      id: "couple",
      memberIds: ["1001", "1002"],
      createdAt: "2026-08-06T00:00:00.000Z"
    });
    expect(await verifyPassword("1013", (await users.get("1001"))!.passwordHash)).toBe(true);
    expect(await verifyPassword("different-password", (await users.get("1001"))!.passwordHash)).toBe(false);
    await expect(users.get("1001")).resolves.toMatchObject({
      displayName: "示例乙",
      gender: "女",
      avatarKey: null,
      profileInitializedVersion: 0
    });
    await expect(users.get("1002")).resolves.toMatchObject({
      displayName: "示例甲",
      gender: "男",
      avatarKey: null,
      profileInitializedVersion: 0
    });
  });

  it("never overwrites an existing password, profile, or active session", async () => {
    const users = new MemoryUserStore();
    const relationships = new MemoryRelationshipStore();
    await seedPrivateChat(users, relationships, "1013");
    const existing = (await users.get("1001"))!;
    await users.save({ ...existing, displayName: "保留我", sessionHash: "active-session", sessionVersion: 9 });

    await seedPrivateChat(users, relationships, "new-password");

    await expect(users.get("1001")).resolves.toMatchObject({
      displayName: "保留我",
      passwordHash: existing.passwordHash,
      sessionHash: "active-session",
      sessionVersion: 9
    });
  });
});
