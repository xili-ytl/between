import { beforeEach, describe, expect, it } from "vitest";
import { MemoryAvatarStore, MemoryUserStore } from "../src/adapters/memory-stores.js";
import { INITIAL_PROFILES, type AccountId, type UserRecord } from "../src/domain/contracts.js";
import { ProfileService } from "../src/services/profile-service.js";

describe("ProfileService", () => {
  let users: MemoryUserStore;
  let avatars: MemoryAvatarStore;
  let service: ProfileService;

  beforeEach(async () => {
    users = new MemoryUserStore();
    avatars = new MemoryAvatarStore();
    service = new ProfileService(users, avatars, () => new Date("2026-08-06T00:00:00.000Z"));
    await users.save(user("1001"));
    await users.save(user("1002"));
  });

  it("updates only the authenticated account display name", async () => {
    const updated = await service.updateDisplayName("1001", "  小猫  ");

    expect(updated.displayName).toBe("小猫");
    await expect(users.get("1002")).resolves.toMatchObject({ displayName: "示例甲" });
  });

  it("validates display names using Unicode code points", async () => {
    await expect(service.updateDisplayName("1001", "   ")).rejects.toMatchObject({ code: "DISPLAY_NAME_INVALID" });
    await expect(service.updateDisplayName("1001", "🐱".repeat(31))).rejects.toMatchObject({ code: "DISPLAY_NAME_INVALID" });
    await expect(service.updateDisplayName("1001", "🐱".repeat(30))).resolves.toMatchObject({
      displayName: "🐱".repeat(30)
    });
  });

  it("stores a small JPEG, PNG, or WebP avatar for the authenticated account", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const updated = await service.updateAvatar("1002", "image/png", bytes);

    expect(updated.avatarKey).toMatch(/^avatars\/1002\/[a-f0-9]{12}\.png$/);
    expect(await avatars.get(updated.avatarKey!)).toMatchObject({ contentType: "image/png", bytes });
    await expect(service.avatarUrl(updated.avatarKey)).resolves.toBe(`memory://${updated.avatarKey}`);
    await expect(users.get("1001")).resolves.toMatchObject({ avatarKey: null });
  });

  it("uses stable content keys so consecutive avatar changes cannot reuse a cached URL", async () => {
    const first = await service.updateAvatar("1001", "image/jpeg", new Uint8Array([1, 2, 3]));
    const repeated = await service.updateAvatar("1001", "image/jpeg", new Uint8Array([1, 2, 3]));
    const replacement = await service.updateAvatar("1001", "image/jpeg", new Uint8Array([3, 2, 1]));

    expect(repeated.avatarKey).toBe(first.avatarKey);
    expect(replacement.avatarKey).not.toBe(first.avatarKey);
  });

  it("rejects unsupported or oversized avatars", async () => {
    await expect(service.updateAvatar("1001", "image/gif", new Uint8Array([1]))).rejects.toMatchObject({
      code: "AVATAR_INVALID"
    });
    await expect(service.updateAvatar("1001", "image/jpeg", new Uint8Array(512 * 1024 + 1))).rejects.toMatchObject({
      code: "AVATAR_INVALID"
    });
  });

  it("lets a prepared display-name edit win after initialization without resetting the marker", async () => {
    const deferredUsers = new DeferredProfileUserStore();
    await deferredUsers.save(user("1001", { displayName: "legacy" }));
    await deferredUsers.save(user("1002"));
    const deferredService = new ProfileService(deferredUsers, avatars, () => new Date("2026-08-08T00:00:00.000Z"));
    deferredUsers.arm();

    const update = deferredService.updateDisplayName("1001", "chosen name");
    await deferredUsers.started;
    await deferredUsers.initializeProfilesIfNeeded(initialFields());
    deferredUsers.finish();
    await update;

    await expect(deferredUsers.get("1001")).resolves.toMatchObject({
      displayName: "chosen name",
      gender: INITIAL_PROFILES["1001"].gender,
      avatarKey: "avatars/1001/initial.jpg",
      profileInitializedVersion: 1
    });
  });

  function user(accountId: AccountId, overrides: Partial<UserRecord> = {}): UserRecord {
    return {
      accountId,
      ...INITIAL_PROFILES[accountId],
      avatarKey: null,
      profileInitializedVersion: 0,
      passwordHash: "unused",
      sessionHash: null,
      sessionVersion: 0,
      updatedAt: "2026-08-06T00:00:00.000Z",
      ...overrides
    };
  }
});

function initialFields() {
  return {
    "1001": { ...INITIAL_PROFILES["1001"], avatarKey: "avatars/1001/initial.jpg", updatedAt: "initialized" },
    "1002": { ...INITIAL_PROFILES["1002"], avatarKey: "avatars/1002/initial.jpg", updatedAt: "initialized" }
  };
}

class DeferredProfileUserStore extends MemoryUserStore {
  readonly started: Promise<void>;
  private start!: () => void;
  private release!: () => void;
  private armed = false;
  private blocked = false;
  private readonly released: Promise<void>;

  constructor() {
    super();
    this.started = new Promise((resolve) => { this.start = resolve; });
    this.released = new Promise((resolve) => { this.release = resolve; });
  }

  arm(): void { this.armed = true; }
  finish(): void { this.release(); }

  override async save(user: UserRecord): Promise<void> {
    await this.pause();
    return super.save(user);
  }

  override async updateDisplayName(
    accountId: AccountId,
    displayName: string,
    updatedAt: string
  ): Promise<UserRecord | null> {
    await this.pause();
    return super.updateDisplayName(accountId, displayName, updatedAt);
  }

  private async pause(): Promise<void> {
    if (!this.armed || this.blocked) return;
    this.blocked = true;
    this.start();
    await this.released;
  }
}
