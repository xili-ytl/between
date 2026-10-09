import { beforeEach, describe, expect, it } from "vitest";
import { MemoryLoginAttemptStore, MemoryPetSessionStore, MemoryUserStore } from "../src/adapters/memory-stores.js";
import { AppError } from "../src/domain/errors.js";
import { INITIAL_PROFILES, type AccountId, type UserRecord } from "../src/domain/contracts.js";
import { hashPassword } from "../src/security/password.js";
import { AuthService } from "../src/services/auth-service.js";
import type { SessionRotationFields } from "../src/ports/stores.js";

const initialPassword = "1013";

describe("AuthService", () => {
  let users: MemoryUserStore;
  let attempts: MemoryLoginAttemptStore;
  let petSessions: MemoryPetSessionStore;
  let now: Date;
  let service: AuthService;

  beforeEach(async () => {
    users = new MemoryUserStore();
    attempts = new MemoryLoginAttemptStore();
    petSessions = new MemoryPetSessionStore();
    now = new Date("2026-08-06T00:00:00.000Z");
    service = new AuthService(users, attempts, petSessions, () => new Date(now));
    await users.save(await user("1001"));
    await users.save(await user("1002"));
  });

  it("a new login invalidates the old device token", async () => {
    const first = await service.login("1001", initialPassword, "source-a");
    const second = await service.login("1001", initialPassword, "source-b");

    await expect(service.authenticate(first.sessionToken)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(service.authenticate(second.sessionToken)).resolves.toMatchObject({ accountId: "1001" });
  });

  it("logout invalidates the active token without deleting the user", async () => {
    const login = await service.login("1002", initialPassword, "source-a");

    await service.logout(login.sessionToken);

    await expect(service.authenticate(login.sessionToken)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(users.get("1002")).resolves.toMatchObject({ accountId: "1002" });
  });

  it("password change verifies the current password and rotates the current session", async () => {
    const login = await service.login("1001", initialPassword, "source-a");

    await expect(service.changePassword(login.sessionToken, "wrong", "new-password"))
      .rejects.toMatchObject({ code: "PASSWORD_INVALID" });

    const replacement = await service.changePassword(login.sessionToken, initialPassword, "new-password");
    await expect(service.authenticate(login.sessionToken)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(service.authenticate(replacement.sessionToken)).resolves.toMatchObject({ accountId: "1001" });
    await expect(service.login("1001", initialPassword, "source-a")).rejects.toMatchObject({ code: "CREDENTIALS_INVALID" });
    await expect(service.login("1001", "new-password", "source-a")).resolves.toMatchObject({ accountId: "1001" });
  });

  it("blocks the same account and source for fifteen minutes after five failures", async () => {
    for (let index = 0; index < 5; index += 1) {
      await expect(service.login("1001", "wrong", "source-a")).rejects.toBeInstanceOf(AppError);
    }

    await expect(service.login("1001", initialPassword, "source-a")).rejects.toMatchObject({ code: "RATE_LIMITED" });

    now = new Date(now.getTime() + 15 * 60 * 1000 + 1);
    await expect(service.login("1001", initialPassword, "source-a")).resolves.toMatchObject({ accountId: "1001" });
  });

  it("a successful login clears earlier failures", async () => {
    await expect(service.login("1002", "wrong", "source-a")).rejects.toMatchObject({ code: "CREDENTIALS_INVALID" });
    await service.login("1002", initialPassword, "source-a");

    expect(await attempts.get("1002", "source-a")).toBeNull();
  });

  it("pet login issues an isolated read-only session that never kicks the phone", async () => {
    const phone = await service.login("1001", initialPassword, "source-a");
    const pet = await service.petLogin("1001", initialPassword, "source-pet");

    // 主会话不受影响：手机依然在线
    await expect(service.authenticate(phone.sessionToken)).resolves.toMatchObject({ accountId: "1001" });
    // pet 会话可用且角色为 pet
    await expect(service.authenticatePet(pet.sessionToken)).resolves.toMatchObject({
      user: { accountId: "1001" },
      role: "pet"
    });
    // pet token 绝不能被当作主会话认证
    await expect(service.authenticate(pet.sessionToken)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("pet login rejects a wrong password and a new pet login rotates the old pet token only", async () => {
    const phone = await service.login("1001", initialPassword, "source-a");
    await expect(service.petLogin("1001", "wrong", "source-pet"))
      .rejects.toMatchObject({ code: "CREDENTIALS_INVALID" });

    const first = await service.petLogin("1001", initialPassword, "source-pet");
    const second = await service.petLogin("1001", initialPassword, "source-pet");
    await expect(service.authenticatePet(first.sessionToken)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(service.authenticatePet(second.sessionToken)).resolves.toMatchObject({
      user: { accountId: "1001" },
      role: "pet"
    });
    // 主会话依旧在线，pet 会话旋转不影响手机
    await expect(service.authenticate(phone.sessionToken)).resolves.toMatchObject({ accountId: "1001" });
  });

  it("expires a desktop pet session after thirty days and removes the stale record", async () => {
    const pet = await service.petLogin("1001", initialPassword, "source-pet");
    await expect(petSessions.get("1001")).resolves.toMatchObject({
      expiresAt: "2026-09-05T00:00:00.000Z"
    });
    await expect(service.authenticatePet(pet.sessionToken)).resolves.toMatchObject({ role: "pet" });

    now = new Date("2026-09-05T00:00:00.001Z");
    await expect(service.authenticatePet(pet.sessionToken)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(petSessions.get("1001")).resolves.toBeNull();
  });

  it("logs out only the desktop pet session and keeps the phone session active", async () => {
    const phone = await service.login("1002", initialPassword, "source-phone");
    const pet = await service.petLogin("1002", initialPassword, "source-pet");

    await service.petLogout(pet.sessionToken);

    await expect(service.authenticatePet(pet.sessionToken)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(service.authenticate(phone.sessionToken)).resolves.toMatchObject({ accountId: "1002" });
  });

  it("does not revert initialized profile fields when a prepared login finishes later", async () => {
    const deferredUsers = new DeferredAuthUserStore();
    await deferredUsers.save(await user("1001", { displayName: "legacy", avatarKey: null }));
    await deferredUsers.save(await user("1002"));
    const deferredService = new AuthService(deferredUsers, attempts, new MemoryPetSessionStore(), () => new Date(now));
    deferredUsers.arm();

    const login = deferredService.login("1001", initialPassword, "source-a");
    await deferredUsers.started;
    await deferredUsers.initializeProfilesIfNeeded(initialFields());
    deferredUsers.finish();
    await login;

    await expect(deferredUsers.get("1001")).resolves.toMatchObject({
      ...INITIAL_PROFILES["1001"],
      avatarKey: "avatars/1001/initial.jpg",
      profileInitializedVersion: 1
    });
  });

  async function user(accountId: AccountId, overrides: Partial<UserRecord> = {}): Promise<UserRecord> {
    return {
      accountId,
      ...INITIAL_PROFILES[accountId],
      avatarKey: null,
      profileInitializedVersion: 0,
      passwordHash: await hashPassword(initialPassword),
      sessionHash: null,
      sessionVersion: 0,
      updatedAt: now.toISOString(),
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

class DeferredAuthUserStore extends MemoryUserStore {
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

  override async rotateSession(accountId: AccountId, fields: SessionRotationFields): Promise<UserRecord | null> {
    await this.pause();
    return super.rotateSession(accountId, fields);
  }

  private async pause(): Promise<void> {
    if (!this.armed || this.blocked) return;
    this.blocked = true;
    this.start();
    await this.released;
  }
}
