import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryAvatarStore,
  MemoryAdminStore,
  MemoryRelationshipStore,
  MemoryUserStore
} from "../src/adapters/memory-stores.js";
import {
  INITIAL_PROFILES,
  type AccountId,
  type AvatarObject,
  type UserRecord
} from "../src/domain/contracts.js";
import { AdminService } from "../src/services/admin-service.js";
import type { InitialProfilesFields, InitializeProfilesResult } from "../src/ports/stores.js";
import { VALID_PASSWORD_HASH, validWenliMessageEntry } from "./backup-fixtures.js";

const INITIALIZED_AT = "2026-08-07T08:09:10.000Z";
const INITIAL_AVATAR_BYTES: Record<AccountId, Uint8Array> = {
  "1001": new Uint8Array(await readFile(new URL("../assets/initial-avatars/1001.jpg", import.meta.url))),
  "1002": new Uint8Array(await readFile(new URL("../assets/initial-avatars/1002.jpg", import.meta.url)))
};

describe("AdminService", () => {
  it("requires the separate backup admin token", async () => {
    const service = setup();
    await expect(service.seed("wrong-token", "1013")).rejects.toMatchObject({ code: "ADMIN_UNAUTHORIZED" });
    await expect(service.exportPage("wrong-token", "messages", null, 500)).rejects.toMatchObject({
      code: "ADMIN_UNAUTHORIZED"
    });
  });

  it("seeds once and exports at most 500 ordered documents", async () => {
    const service = setup();
    await expect(service.seed("admin-secret", "1013")).resolves.toEqual({
      createdAccounts: ["1001", "1002"],
      relationshipCreated: true
    });
    await expect(service.seed("admin-secret", "another-password")).resolves.toEqual({
      createdAccounts: [],
      relationshipCreated: false
    });

    await expect(service.exportPage("admin-secret", "users", null, 501)).rejects.toMatchObject({
      code: "ADMIN_PAGE_INVALID"
    });
    await expect(service.exportPage("admin-secret", "users", null, 500)).resolves.toMatchObject({
      entries: [{ id: "1001" }, { id: "1002" }],
      nextCursor: "1002"
    });
  });

  it("restores only missing deterministic ids and cannot replace existing data", async () => {
    const users = new MemoryUserStore();
    const relationships = new MemoryRelationshipStore();
    const backups = new MemoryAdminStore();
    const service = new AdminService(
      "admin-secret",
      users,
      relationships,
      backups,
      new MemoryAvatarStore(),
      () => new Date(INITIALIZED_AT)
    );
    await backups.importMissing("messages", [messageEntry("1001", "m-1", "original")]);

    const result = await service.importMissingPage("admin-secret", "messages", [
      messageEntry("1001", "m-1", "replacement"),
      messageEntry("1002", "m-2", "new")
    ]);

    expect(result).toEqual({ attempted: 2, inserted: 1 });
    await expect(backups.exportPage("messages", null, 500)).resolves.toMatchObject({
      entries: [
        { id: "1001_m-1", data: { body: "original" } },
        { id: "1002_m-2", data: { body: "new" } }
      ]
    });
  });

  it("exports and restores Wenli jobs and memories append-only", async () => {
    const service = setup();
    const job = {
      id: "1001_m-1",
      data: {
        id: "1001_m-1",
        type: "mention",
        requesterId: "1001",
        sourceMessageId: "1001_m-1",
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: INITIALIZED_AT,
        createdAt: INITIALIZED_AT,
        updatedAt: INITIALIZED_AT
      }
    };
    const memory = {
      id: "mem_admin_1",
      data: {
        id: "mem_admin_1",
        kind: "fact",
        summary: "他们喜欢一起回忆童年。",
        speakerIds: ["1001", "1002"],
        sourceEventIds: ["1001_m-1"],
        salience: 50,
        status: "active",
        createdAt: INITIALIZED_AT,
        updatedAt: INITIALIZED_AT
      }
    };

    await expect(service.importMissingPage("admin-secret", "wenliAgentJobs", [job]))
      .resolves.toEqual({ attempted: 1, inserted: 1 });
    await expect(service.importMissingPage("admin-secret", "wenliMemories", [memory]))
      .resolves.toEqual({ attempted: 1, inserted: 1 });
    await expect(service.importMissingPage("admin-secret", "wenliAgentJobs", [job]))
      .resolves.toEqual({ attempted: 1, inserted: 0 });
    await expect(service.exportPage("admin-secret", "wenliAgentJobs", null, 500))
      .resolves.toEqual({ entries: [job], nextCursor: job.id });
    await expect(service.exportPage("admin-secret", "wenliMemories", null, 500))
      .resolves.toEqual({ entries: [memory], nextCursor: memory.id });
  });

  it("restores and exports Wenli replies with their source trace intact", async () => {
    const backups = new MemoryAdminStore();
    const service = new AdminService(
      "admin-secret",
      new MemoryUserStore(),
      new MemoryRelationshipStore(),
      backups,
      new MemoryAvatarStore(),
      () => new Date(INITIALIZED_AT)
    );
    const source = messageEntry("1001", "m-wenli-source", "@小Q 在吗");
    const wenliReply = validWenliMessageEntry(source.id);

    await expect(service.importMissingPage("admin-secret", "messages", [source, wenliReply]))
      .resolves.toEqual({ attempted: 2, inserted: 2 });
    await expect(service.exportPage("admin-secret", "messages", null, 500))
      .resolves.toEqual({ entries: [source, wenliReply], nextCursor: wenliReply.id });
  });

  it("exports and restores all four append-only collections without overwriting existing ids", async () => {
    const users = new MemoryUserStore();
    const relationships = new MemoryRelationshipStore();
    const backups = new MemoryAdminStore();
    const service = new AdminService(
      "admin-secret",
      users,
      relationships,
      backups,
      new MemoryAvatarStore(),
      () => new Date(INITIALIZED_AT)
    );
    const fixtures = {
      messages: [messageEntry("1001", "m-1", "message")],
      moments: [momentEntry("1001", "post-1", "moment")],
      momentLikes: [likeEntry("1001_post-1", "1002")],
      momentComments: [commentEntry("1001_post-1", "1002", "comment-1", "comment")]
    } as const;

    for (const [collection, entries] of Object.entries(fixtures)) {
      await expect(service.importMissingPage("admin-secret", collection, [...entries]))
        .resolves.toEqual({ attempted: 1, inserted: 1 });
      await expect(service.importMissingPage("admin-secret", collection, [...entries]))
        .resolves.toEqual({ attempted: 1, inserted: 0 });
      await expect(service.exportPage("admin-secret", collection, null, 500))
        .resolves.toEqual({ entries, nextCursor: entries[0]!.id });
    }
  });

  it("validates every append-only backup entry before writing any of the page", async () => {
    const backups = new MemoryAdminStore();
    const service = new AdminService(
      "admin-secret",
      new MemoryUserStore(),
      new MemoryRelationshipStore(),
      backups,
      new MemoryAvatarStore(),
      () => new Date(INITIALIZED_AT)
    );
    const invalidMoment = momentEntry("1001", "bad-time", "bad");
    invalidMoment.data.createdAt = "not-an-iso-timestamp";

    await expect(service.importMissingPage("admin-secret", "moments", [
      momentEntry("1001", "valid", "valid"),
      invalidMoment
    ])).rejects.toMatchObject({ code: "ADMIN_DOCUMENT_INVALID" });
    await expect(backups.exportPage("moments", null, 500)).resolves.toEqual({
      entries: [],
      nextCursor: null
    });
  });

  it.each([
    ["messages", { id: "1001_m-1", data: { ...messageEntry("1001", "m-1", "body").data, senderId: "1002" } }],
    ["moments", { id: "1001_post-1", data: { ...momentEntry("1001", "post-1", "body").data, visibility: "PUBLIC" } }],
    ["moments", { id: "1001_post-1", data: { ...momentEntry("1001", "post-1", "body").data, deleting: "false" } }],
    ["moments", { id: "1001_post-1", data: { ...momentEntry("1001", "post-1", "body").data, interactionVersion: -1 } }],
    ["momentLikes", { id: "1001_post-1_1002", data: { ...likeEntry("1001_post-1", "1002").data, accountId: "1001" } }],
    ["momentComments", { id: "1002_comment-1", data: { ...commentEntry("1001_post-1", "1002", "comment-1", "body").data, authorId: "1001" } }]
  ])("rejects malformed %s documents", async (collection, entry) => {
    await expect(setup().importMissingPage("admin-secret", collection, [entry]))
      .rejects.toMatchObject({ code: "ADMIN_DOCUMENT_INVALID" });
  });

  it("restores compatible legacy users with explicit gender and profile-version defaults", async () => {
    const users = new MemoryUserStore();
    const legacyData = { ...user("1001") } as Record<string, unknown>;
    Reflect.deleteProperty(legacyData, "gender");
    Reflect.deleteProperty(legacyData, "profileInitializedVersion");
    const service = setup(users);

    await expect(service.importMissingPage("admin-secret", "users", [{
      id: "1001",
      data: legacyData
    }])).resolves.toEqual({ attempted: 1, inserted: 1 });
    await expect(users.get("1001")).resolves.toMatchObject({
      gender: INITIAL_PROFILES["1001"].gender,
      profileInitializedVersion: 0
    });
  });

  it("atomically restores a missing user without overwriting one created after a stale read", async () => {
    const existing = user("1001", { displayName: "concurrent account" });
    const users = new UserAppearsAfterReadStore(existing);
    const replacement = user("1001", { displayName: "backup replacement" });

    await expect(setup(users).importMissingPage("admin-secret", "users", [{
      id: replacement.accountId,
      data: { ...replacement }
    }])).resolves.toEqual({ attempted: 1, inserted: 0 });
    await expect(users.get("1001")).resolves.toEqual(existing);
  });

  it("reports exactly one insertion when concurrent restores target the same user", async () => {
    const users = new MemoryUserStore();
    const original = user("1001", { displayName: "first backup" });
    const replacement = user("1001", { displayName: "second backup" });

    const results = await Promise.all([
      users.restoreIfAbsent(original),
      users.restoreIfAbsent(replacement)
    ]);

    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    await expect(users.get("1001")).resolves.toEqual(results[0]!.user);
  });

  it.each([
    ["gender", "unknown"],
    ["profileInitializedVersion", -1],
    ["profileInitializedVersion", 1.5]
  ])("rejects an invalid user %s field", async (field, value) => {
    await expect(setup().importMissingPage("admin-secret", "users", [{
      id: "1001",
      data: { ...user("1001"), [field]: value }
    }])).rejects.toMatchObject({ code: "ADMIN_DOCUMENT_INVALID" });
  });

  it.each([
    ["empty display name", { displayName: "" }],
    ["untrimmed display name", { displayName: " name " }],
    ["wrong fixed gender", { gender: INITIAL_PROFILES["1002"].gender }],
    ["malformed password hash", { passwordHash: "scrypt$bad$also-bad" }],
    ["malformed session hash", { sessionHash: "ABC123" }],
    ["empty avatar key", { avatarKey: "" }],
    ["untrimmed avatar key", { avatarKey: " avatar.jpg " }],
    ["control-character avatar key", { avatarKey: "avatar\u0000.jpg" }]
  ])("rejects a user with %s", async (_label, fields) => {
    await expect(setup().importMissingPage("admin-secret", "users", [{
      id: "1001",
      data: { ...user("1001"), ...fields }
    }])).rejects.toMatchObject({ code: "ADMIN_DOCUMENT_INVALID" });
  });

  it("rejects unsupported backup collections", async () => {
    await expect(setup().exportPage("admin-secret", "login_attempts", null, 500))
      .rejects.toMatchObject({ code: "ADMIN_COLLECTION_INVALID" });
    await expect(setup().importMissingPage("admin-secret", "login_attempts", []))
      .rejects.toMatchObject({ code: "ADMIN_COLLECTION_INVALID" });
  });

  it("initializes both fixed profiles once in deterministic order", async () => {
    const users = new MemoryUserStore();
    const avatarStore = new MemoryAvatarStore();
    await users.save(user("1001", { displayName: "legacy 1001", gender: "男" }));
    await users.save(user("1002", { displayName: "legacy 1002", gender: "女" }));
    const service = setup(users, avatarStore);
    const avatars = initialAvatars();

    await expect(service.initializeProfiles("admin-secret", avatars)).resolves.toEqual({
      initializedAccounts: ["1001", "1002"]
    });

    for (const accountId of ["1001", "1002"] as const) {
      await expect(users.get(accountId)).resolves.toEqual({
        ...user(accountId),
        ...INITIAL_PROFILES[accountId],
        avatarKey: `avatars/${accountId}/initial.jpg`,
        profileInitializedVersion: 1,
        updatedAt: INITIALIZED_AT
      });
      await expect(avatarStore.get(`avatars/${accountId}/initial.jpg`)).resolves.toEqual(avatars[accountId]);
    }
  });

  it("skips an initialized profile completely and never overwrites a later display-name change", async () => {
    const users = new MemoryUserStore();
    const avatarStore = new MemoryAvatarStore();
    await users.save(user("1001"));
    await users.save(user("1002"));
    const service = setup(users, avatarStore);
    await service.initializeProfiles("admin-secret", initialAvatars());

    const initialized = await users.get("1001");
    if (!initialized) throw new Error("expected initialized user");
    await users.save({ ...initialized, displayName: "my chosen name", updatedAt: "2026-08-08T00:00:00.000Z" });

    await expect(service.initializeProfiles("admin-secret", initialAvatars()))
      .resolves.toEqual({ initializedAccounts: [] });
    await expect(users.get("1001")).resolves.toMatchObject({
      displayName: "my chosen name",
      updatedAt: "2026-08-08T00:00:00.000Z"
    });
    await expect(avatarStore.get("avatars/1001/initial.jpg")).resolves.toEqual(initialAvatars()["1001"]);
  });

  it("requires the admin token before initializing profiles", async () => {
    const users = new MemoryUserStore();
    const avatarStore = new MemoryAvatarStore();
    await users.save(user("1001"));
    await users.save(user("1002"));

    await expect(setup(users, avatarStore).initializeProfiles("wrong-token", initialAvatars()))
      .rejects.toMatchObject({ code: "ADMIN_UNAUTHORIZED" });
    await expect(avatarStore.get("avatars/1001/initial.jpg")).resolves.toBeNull();
  });

  it("preflights a missing 1002 account before uploading or changing 1001", async () => {
    const users = new MemoryUserStore();
    const avatarStore = new MemoryAvatarStore();
    await users.save(user("1001"));
    const save = vi.spyOn(users, "save");
    const put = vi.spyOn(avatarStore, "put");

    await expect(setup(users, avatarStore).initializeProfiles("admin-secret", initialAvatars()))
      .rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(save).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    await expect(users.get("1001")).resolves.toEqual(user("1001"));
  });

  it.each([
    ["non-JPEG", { contentType: "image/png", bytes: INITIAL_AVATAR_BYTES["1001"] } satisfies AvatarObject],
    ["empty JPEG", jpeg([])],
    ["oversized JPEG", jpeg(new Uint8Array(512 * 1024 + 1))]
  ])("rejects an invalid %s initial avatar", async (_label, invalidAvatar) => {
    const users = new MemoryUserStore();
    await users.save(user("1001"));
    await users.save(user("1002"));

    await expect(setup(users).initializeProfiles("admin-secret", {
      ...initialAvatars(),
      "1001": invalidAvatar
    })).rejects.toMatchObject({ code: "AVATAR_INVALID" });
  });

  it("rejects a missing supplied initial avatar", async () => {
    const users = new MemoryUserStore();
    const avatarStore = new MemoryAvatarStore();
    await users.save(user("1001"));
    await users.save(user("1002"));
    const avatars = initialAvatars();
    Reflect.deleteProperty(avatars, "1002");
    const save = vi.spyOn(users, "save");
    const put = vi.spyOn(avatarStore, "put");

    await expect(setup(users, avatarStore).initializeProfiles("admin-secret", avatars))
      .rejects.toMatchObject({ code: "AVATAR_INVALID" });
    expect(save).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    await expect(users.get("1001")).resolves.toEqual(user("1001"));
  });

  it("preflights a same-size fake 1002 asset before uploading or changing 1001", async () => {
    const users = new MemoryUserStore();
    const avatarStore = new MemoryAvatarStore();
    await users.save(user("1001"));
    await users.save(user("1002"));
    const save = vi.spyOn(users, "save");
    const put = vi.spyOn(avatarStore, "put");
    const avatars = initialAvatars();
    avatars["1002"] = jpeg(sameSizeFake("1002"));

    await expect(setup(users, avatarStore).initializeProfiles("admin-secret", avatars))
      .rejects.toMatchObject({ code: "AVATAR_INVALID" });
    expect(save).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    await expect(users.get("1001")).resolves.toEqual(user("1001"));
  });

  it("rejects swapped exact supplied assets", async () => {
    const users = new MemoryUserStore();
    await users.save(user("1001"));
    await users.save(user("1002"));

    await expect(setup(users).initializeProfiles("admin-secret", {
      "1001": jpeg(INITIAL_AVATAR_BYTES["1002"]),
      "1002": jpeg(INITIAL_AVATAR_BYTES["1001"])
    })).rejects.toMatchObject({ code: "AVATAR_INVALID" });
  });

  it("allows only one concurrent initializer to claim each account", async () => {
    const users = new MemoryUserStore();
    const avatarStore = new MemoryAvatarStore();
    await users.save(user("1001"));
    await users.save(user("1002"));
    const service = setup(users, avatarStore);

    const results = await Promise.all([
      service.initializeProfiles("admin-secret", initialAvatars()),
      service.initializeProfiles("admin-secret", initialAvatars())
    ]);

    expect(results.flatMap((result) => result.initializedAccounts)).toEqual(["1001", "1002"]);
  });

  it("preserves password and session changes made after preflight", async () => {
    const users = new MemoryUserStore();
    await users.save(user("1001"));
    await users.save(user("1002"));
    const avatarStore = new ConcurrentChangeAvatarStore(users);

    await setup(users, avatarStore).initializeProfiles("admin-secret", initialAvatars());

    await expect(users.get("1001")).resolves.toMatchObject({
      passwordHash: "concurrent-password-hash",
      sessionHash: "concurrent-session-hash",
      sessionVersion: 7
    });
  });

  it("initializes neither user when the second upload fails, then succeeds on retry", async () => {
    const users = new MemoryUserStore();
    const avatarStore = new SecondUploadFailsAvatarStore();
    await users.save(user("1001"));
    await users.save(user("1002"));
    const service = setup(users, avatarStore);

    await expect(service.initializeProfiles("admin-secret", initialAvatars())).rejects.toThrow("second upload failed");
    await expect(users.get("1001")).resolves.toMatchObject({ profileInitializedVersion: 0 });
    await expect(users.get("1002")).resolves.toMatchObject({ profileInitializedVersion: 0 });
    await expect(service.initializeProfiles("admin-secret", initialAvatars())).resolves.toEqual({
      initializedAccounts: ["1001", "1002"]
    });
  });

  it("initializes neither user when the combined transaction fails, then succeeds on retry", async () => {
    const users = new TransactionFailsOnceUserStore();
    await users.save(user("1001"));
    await users.save(user("1002"));
    const service = setup(users);

    await expect(service.initializeProfiles("admin-secret", initialAvatars())).rejects.toThrow("transaction failed");
    await expect(users.get("1001")).resolves.toMatchObject({ profileInitializedVersion: 0 });
    await expect(users.get("1002")).resolves.toMatchObject({ profileInitializedVersion: 0 });
    await expect(service.initializeProfiles("admin-secret", initialAvatars())).resolves.toEqual({
      initializedAccounts: ["1001", "1002"]
    });
  });

  it("atomically initializes only the pending account in a mixed retry state", async () => {
    const users = new MemoryUserStore();
    await users.save(user("1001", { displayName: "chosen", profileInitializedVersion: 1 }));
    await users.save(user("1002"));

    await expect(setup(users).initializeProfiles("admin-secret", initialAvatars())).resolves.toEqual({
      initializedAccounts: ["1002"]
    });
    await expect(users.get("1001")).resolves.toMatchObject({ displayName: "chosen", profileInitializedVersion: 1 });
  });
});

function setup(
  users = new MemoryUserStore(),
  avatars = new MemoryAvatarStore()
): AdminService {
  return new AdminService(
    "admin-secret",
    users,
    new MemoryRelationshipStore(),
    new MemoryAdminStore(),
    avatars,
    () => new Date(INITIALIZED_AT)
  );
}

function user(accountId: AccountId, overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    accountId,
    ...INITIAL_PROFILES[accountId],
    avatarKey: null,
    profileInitializedVersion: 0,
    passwordHash: VALID_PASSWORD_HASH,
    sessionHash: null,
    sessionVersion: 0,
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides
  };
}

function initialAvatars(): Record<AccountId, AvatarObject> {
  return {
    "1001": jpeg(INITIAL_AVATAR_BYTES["1001"]),
    "1002": jpeg(INITIAL_AVATAR_BYTES["1002"])
  };
}

function jpeg(bytes: number[] | Uint8Array): AvatarObject {
  return { contentType: "image/jpeg", bytes: new Uint8Array(bytes) };
}

function sameSizeFake(accountId: AccountId): Uint8Array {
  const bytes = new Uint8Array(INITIAL_AVATAR_BYTES[accountId]);
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
  return bytes;
}

class ConcurrentChangeAvatarStore extends MemoryAvatarStore {
  private changed = false;

  constructor(private readonly users: MemoryUserStore) {
    super();
  }

  override async put(key: string, avatar: AvatarObject): Promise<string> {
    if (!this.changed) {
      this.changed = true;
      const latest = await this.users.get("1001");
      if (!latest) throw new Error("expected 1001 during upload");
      await this.users.save({
        ...latest,
        passwordHash: "concurrent-password-hash",
        sessionHash: "concurrent-session-hash",
        sessionVersion: 7
      });
    }
    return super.put(key, avatar);
  }
}

class UserAppearsAfterReadStore extends MemoryUserStore {
  private appeared = false;

  constructor(private readonly concurrentUser: UserRecord) {
    super();
  }

  override async get(accountId: AccountId): Promise<UserRecord | null> {
    if (!this.appeared && accountId === this.concurrentUser.accountId) {
      this.appeared = true;
      await this.save(this.concurrentUser);
      return null;
    }
    return super.get(accountId);
  }

  override async restoreIfAbsent(user: UserRecord): Promise<{ user: UserRecord; inserted: boolean }> {
    if (!this.appeared) {
      this.appeared = true;
      await this.save(this.concurrentUser);
    }
    return super.restoreIfAbsent(user);
  }
}

class SecondUploadFailsAvatarStore extends MemoryAvatarStore {
  private calls = 0;
  private failed = false;

  override async put(key: string, avatar: AvatarObject): Promise<string> {
    this.calls += 1;
    if (!this.failed && this.calls === 2) {
      this.failed = true;
      throw new Error("second upload failed");
    }
    return super.put(key, avatar);
  }
}

class TransactionFailsOnceUserStore extends MemoryUserStore {
  private failed = false;

  override async initializeProfilesIfNeeded(fields: InitialProfilesFields): Promise<InitializeProfilesResult> {
    if (!this.failed) {
      this.failed = true;
      throw new Error("transaction failed");
    }
    return super.initializeProfilesIfNeeded(fields);
  }
}

function messageEntry(senderId: AccountId, clientMessageId: string, body: string) {
  const recipientId: AccountId = senderId === "1001" ? "1002" : "1001";
  const id = `${senderId}_${clientMessageId}`;
  return {
    id,
    data: {
      id,
      relationshipId: "couple",
      senderId,
      recipientId,
      clientMessageId,
      body,
      createdAt: "2026-08-07T00:00:00.000Z"
    }
  };
}

function momentEntry(authorId: AccountId, clientMomentId: string, body: string) {
  const id = `${authorId}_${clientMomentId}`;
  return {
    id,
    data: {
      id,
      authorId,
      clientMomentId,
      body,
      visibility: "PARTNER",
      createdAt: "2026-08-07T00:00:00.000Z",
      deleting: false,
      interactionVersion: 0
    }
  };
}

function likeEntry(momentId: string, accountId: AccountId) {
  const id = `${momentId}_${accountId}`;
  return {
    id,
    data: { id, momentId, accountId, createdAt: "2026-08-07T00:00:01.000Z" }
  };
}

function commentEntry(momentId: string, authorId: AccountId, clientCommentId: string, body: string) {
  const id = `${authorId}_${clientCommentId}`;
  return {
    id,
    data: { id, momentId, authorId, clientCommentId, body, createdAt: "2026-08-07T00:00:02.000Z" }
  };
}
