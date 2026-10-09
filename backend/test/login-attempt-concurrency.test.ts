import type { CloudBase } from "@cloudbase/node-sdk";
import { describe, expect, it } from "vitest";
import { NodeCloudBasePersistence } from "../src/adapters/cloudbase-persistence.js";
import { CloudBaseLoginAttemptStore } from "../src/adapters/cloudbase-stores.js";
import { MemoryLoginAttemptStore, MemoryPetSessionStore, MemoryUserStore } from "../src/adapters/memory-stores.js";
import { INITIAL_PROFILES, type AccountId } from "../src/domain/contracts.js";
import type { LoginAttemptRecord, LoginFailurePolicy } from "../src/ports/stores.js";
import { hashPassword } from "../src/security/password.js";
import { AuthService } from "../src/services/auth-service.js";

const now = new Date("2026-10-09T00:00:00.000Z");
const blockedUntil = "2026-10-09T00:15:00.000Z";
const policy: LoginFailurePolicy = { now: now.toISOString(), maxFailures: 5, blockMilliseconds: 15 * 60 * 1000 };

describe("concurrent login failures", () => {
  it.each(["login", "petLogin"] as const)("counts five simultaneous %s failures across persistence instances and blocks correct credentials", async (method) => {
    const database = sharedDatabase();
    const services = Array.from({ length: 5 }, () => new AuthService(
      new MemoryUserStore(),
      new CloudBaseLoginAttemptStore(new NodeCloudBasePersistence({ database: () => database } as unknown as CloudBase)),
      new MemoryPetSessionStore(),
      () => new Date(now)
    ));

    // An absent account follows the same failure-recording branch without password hashing timing.
    const results = await Promise.allSettled(services.map((service) => service[method]("1001", "wrong", "source-a")));
    expect(results.map((result) => result.status === "rejected" && result.reason.code)).toEqual(
      Array(5).fill("CREDENTIALS_INVALID")
    );
    const attempts = new CloudBaseLoginAttemptStore(new NodeCloudBasePersistence({ database: () => database } as unknown as CloudBase));
    await expect(attempts.get("1001", "source-a")).resolves.toEqual({ failures: 5, blockedUntil });
    const correct = new AuthService(await validUsers(), attempts, new MemoryPetSessionStore(), () => new Date(now));
    await expect(correct[method]("1001", "correct-password", "source-a")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(database.conflicts).toBeGreaterThan(0);
  });

  it("shares the five-failure threshold between concurrent main and pet logins from the same source", async () => {
    const database = sharedDatabase();
    const methods = ["login", "petLogin", "login", "petLogin", "login"] as const;
    const services = methods.map(() => new AuthService(
      new MemoryUserStore(),
      new CloudBaseLoginAttemptStore(new NodeCloudBasePersistence({ database: () => database } as unknown as CloudBase)),
      new MemoryPetSessionStore(),
      () => new Date(now)
    ));

    const results = await Promise.allSettled(methods.map((method, index) => services[index]![method]("1001", "wrong", "source-a")));

    expect(results.map((result) => result.status === "rejected" && result.reason.code)).toEqual(Array(5).fill("CREDENTIALS_INVALID"));
    const attempts = new CloudBaseLoginAttemptStore(new NodeCloudBasePersistence({ database: () => database } as unknown as CloudBase));
    await expect(attempts.get("1001", "source-a")).resolves.toEqual({ failures: 5, blockedUntil });
    const correct = new AuthService(await validUsers(), attempts, new MemoryPetSessionStore(), () => new Date(now));
    await expect(correct.login("1001", "correct-password", "source-a")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(correct.petLogin("1001", "correct-password", "source-a")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(database.conflicts).toBeGreaterThan(0);
  });

  it("counts concurrent failures in the memory store without losing increments", async () => {
    const attempts = new MemoryLoginAttemptStore();
    const service = new AuthService(new MemoryUserStore(), attempts, new MemoryPetSessionStore(), () => new Date(now));

    await Promise.allSettled(Array.from({ length: 5 }, () => service.login("1001", "wrong", "source-a")));

    await expect(attempts.get("1001", "source-a")).resolves.toEqual({ failures: 5, blockedUntil });
  });

  it("does not let a stale expired-lock read erase a failure from another request", async () => {
    const attempts = new DeferredExpiredAttemptStore();
    await attempts.save("1001", "source-a", { failures: 5, blockedUntil: now.toISOString() });
    const service = new AuthService(new MemoryUserStore(), attempts, new MemoryPetSessionStore(), () => new Date(now));
    const stale = service.login("1001", "wrong", "source-a").catch((error: unknown) => error);
    await attempts.started;
    await expect(service.login("1001", "wrong", "source-a")).rejects.toMatchObject({ code: "CREDENTIALS_INVALID" });
    attempts.finish();
    await expect(stale).resolves.toMatchObject({ code: "CREDENTIALS_INVALID" });

    await expect(attempts.get("1001", "source-a")).resolves.toEqual({ failures: 2, blockedUntil: null });
  });
});

describe.each(["memory", "cloud"] as const)("%s login attempt rules", (adapter) => {
  function store() {
    if (adapter === "memory") return new MemoryLoginAttemptStore();
    const database = sharedDatabase();
    return new CloudBaseLoginAttemptStore(new NodeCloudBasePersistence({ database: () => database } as unknown as CloudBase));
  }

  it("preserves the original lock deadline for failures already in flight and isolates account/source keys", async () => {
    const attempts = store();
    for (let failures = 1; failures <= 4; failures += 1) {
      await expect(attempts.recordFailure("1001", "source-a", policy)).resolves.toEqual({ failures, blockedUntil: null });
    }
    await expect(attempts.recordFailure("1001", "source-a", policy)).resolves.toEqual({ failures: 5, blockedUntil });
    await expect(attempts.recordFailure("1001", "source-a", { ...policy, now: "2026-10-09T00:14:59.999Z" }))
      .resolves.toEqual({ failures: 5, blockedUntil });
    await expect(attempts.recordFailure("1001", "source-b", policy)).resolves.toEqual({ failures: 1, blockedUntil: null });
    await expect(attempts.recordFailure("1002", "source-a", policy)).resolves.toEqual({ failures: 1, blockedUntil: null });
    await attempts.clear("1001", "source-a");
    await expect(attempts.recordFailure("1001", "source-a", policy)).resolves.toEqual({ failures: 1, blockedUntil: null });
  });

  it("starts a fresh count at the exact expiry and resets it only once across concurrent failures", async () => {
    const attempts = store();
    await attempts.save("1001", "source-a", { failures: 5, blockedUntil: policy.now });
    await expect(attempts.recordFailure("1001", "source-a", policy)).resolves.toEqual({ failures: 1, blockedUntil: null });
    await attempts.save("1001", "source-a", { failures: 5, blockedUntil: policy.now });

    await Promise.all(Array.from({ length: 5 }, () => attempts.recordFailure("1001", "source-a", policy)));

    await expect(attempts.get("1001", "source-a")).resolves.toEqual({ failures: 5, blockedUntil });
  });
});

class DeferredExpiredAttemptStore extends MemoryLoginAttemptStore {
  readonly started: Promise<void>;
  private start!: () => void;
  private release!: () => void;
  private readonly released: Promise<void>;
  private paused = false;

  constructor() {
    super();
    this.started = new Promise((resolve) => { this.start = resolve; });
    this.released = new Promise((resolve) => { this.release = resolve; });
  }

  finish() { this.release(); }

  override async get(accountId: AccountId, source: string): Promise<LoginAttemptRecord | null> {
    const record = await super.get(accountId, source);
    if (!this.paused) {
      this.paused = true;
      this.start();
      await this.released;
    }
    return record;
  }
}

async function validUsers(): Promise<MemoryUserStore> {
  const users = new MemoryUserStore();
  await users.save({
    accountId: "1001",
    ...INITIAL_PROFILES["1001"],
    avatarKey: null,
    profileInitializedVersion: 0,
    passwordHash: await hashPassword("correct-password"),
    sessionHash: null,
    sessionVersion: 0,
    updatedAt: now.toISOString()
  });
  return users;
}

interface TestTransaction {
  collection(collection: string): { doc(id: string): {
    get(): Promise<{ data: Record<string, unknown> | null }>;
    set(data: Record<string, unknown>): Promise<Record<string, never>>;
    remove(): Promise<Record<string, never>>;
  } };
}

/** Optimistic commits share versions across adapter instances and rerun conflicted callbacks. */
function sharedDatabase() {
  const documents = new Map<string, Record<string, unknown>>();
  const versions = new Map<string, number>();
  const state = { conflicts: 0 };
  const key = (collection: string, id: string) => `${collection}:${id}`;
  const database = {
    get conflicts() { return state.conflicts; },
    collection: (collection: string) => ({
      doc: (id: string) => ({
        get: async () => ({ data: structuredClone(documents.get(key(collection, id)) ?? null) }),
        set: async (data: Record<string, unknown>) => {
          const documentKey = key(collection, id);
          documents.set(documentKey, structuredClone(data));
          versions.set(documentKey, (versions.get(documentKey) ?? 0) + 1);
          return {};
        },
        remove: async () => {
          const documentKey = key(collection, id);
          documents.delete(documentKey);
          versions.set(documentKey, (versions.get(documentKey) ?? 0) + 1);
          return {};
        }
      })
    }),
    async runTransaction<T>(callback: (transaction: TestTransaction) => Promise<T>, retries = 3): Promise<T> {
      for (let attempt = 0; ; attempt += 1) {
        const readVersions = new Map<string, number>();
        const staged = new Map<string, Record<string, unknown>>();
        const transaction = {
          collection: (collection: string) => ({
            doc: (id: string) => ({
              get: async () => {
                const documentKey = key(collection, id);
                readVersions.set(documentKey, versions.get(documentKey) ?? 0);
                return { data: structuredClone(documents.get(documentKey) ?? null) };
              },
              set: async (data: Record<string, unknown>) => {
                staged.set(key(collection, id), structuredClone(data));
                return {};
              },
              remove: async () => { throw new Error("unexpected transactional removal"); }
            })
          })
        };
        const result = await callback(transaction);
        if ([...readVersions].some(([documentKey, version]) => version !== (versions.get(documentKey) ?? 0))) {
          state.conflicts += 1;
          if (attempt >= retries) throw { code: "DATABASE_TRANSACTION_CONFLICT" };
          continue;
        }
        for (const [documentKey, data] of staged) {
          documents.set(documentKey, data);
          versions.set(documentKey, (versions.get(documentKey) ?? 0) + 1);
        }
        return result;
      }
    }
  };
  return database;
}
