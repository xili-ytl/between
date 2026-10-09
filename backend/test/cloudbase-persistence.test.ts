import type { CloudBase } from "@cloudbase/node-sdk";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { NodeCloudBasePersistence } from "../src/adapters/cloudbase-persistence.js";

describe("NodeCloudBasePersistence", () => {
  it("rejects fulfilled SDK errors while recording a login failure without hiding read or write failures", async () => {
    const policy = { now: "2026-10-09T00:00:00.000Z", maxFailures: 5, blockMilliseconds: 900_000 };
    for (const operation of ["get", "set"] as const) {
      const error = cloudBaseError(`login ${operation} failed`);
      const set = vi.fn().mockResolvedValue(operation === "set" ? error : {});
      const transaction = transactionDocument({ get: operation === "get" ? error : { data: null }, set });
      const database = { runTransaction: async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction) };
      const persistence = new NodeCloudBasePersistence({ database: () => database } as unknown as CloudBase);

      await expect(persistence.recordLoginFailure("attempt-id", policy)).rejects.toBe(error);
      expect(set).toHaveBeenCalledTimes(operation === "set" ? 1 : 0);
    }
  });

  it.each([false, true])("recalculates a login failure on the installed SDK transaction retry with throwOnCode=%s", async (throwOnCode) => {
    const testRequire = createRequire(import.meta.url);
    const nodeSdkRequire = createRequire(testRequire.resolve("@cloudbase/node-sdk/package.json"));
    const { Db } = nodeSdkRequire(nodeSdkRequire.resolve("@cloudbase/database")) as {
      Db: { new(config?: unknown): unknown; reqClass: unknown };
    };
    const originalRequestClass = Db.reqClass;
    const writes: Array<Record<string, unknown>> = [];
    const databaseRequire = createRequire(nodeSdkRequire.resolve("@cloudbase/database"));
    const { EJSON } = databaseRequire("bson") as { EJSON: { parse(value: string): unknown } };
    const reads: number[] = [];
    let latest = { failures: 3, blockedUntil: null as string | null };
    let starts = 0;
    let commits = 0;
    const staged = new Map<string, typeof latest>();
    class FakeDatabaseRequest {
      async send(interfaceName: string, parameters: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        const transactionId = String(parameters.transactionId);
        if (interfaceName === "database.startTransaction") return { transactionId: `login-transaction-${++starts}` };
        if (interfaceName === "database.getDocument") {
          expect(parameters.collectionName).toBe("login_attempts");
          expect(JSON.parse(String(parameters.query))).toEqual({ _id: "attempt-id" });
          expect(transactionId).toMatch(/^login-transaction-/);
          reads.push(latest.failures);
          return { data: { list: [JSON.stringify({ _id: "attempt-id", ...latest })] }, requestId: "read-login" };
        }
        if (interfaceName === "database.modifyDocument") {
          expect(parameters.collectionName).toBe("login_attempts");
          expect(parameters.merge).toBe(false);
          const data = EJSON.parse(String(parameters.data)) as typeof latest;
          writes.push(structuredClone(data));
          staged.set(transactionId, data);
          return { data: { updated: 1 }, requestId: "write-login" };
        }
        if (interfaceName === "database.commitTransaction") {
          if (++commits === 1) {
            // A different instance commits a fourth failure; this transaction must read again.
            latest = { failures: 4, blockedUntil: null };
            return { code: "DATABASE_TRANSACTION_CONFLICT", message: "concurrent failure", requestId: "conflict-login" };
          }
          latest = staged.get(transactionId)!;
          return { requestId: "commit-login" };
        }
        if (interfaceName === "database.abortTransaction") return { requestId: "abort-login" };
        throw new Error(`unexpected installed database request: ${interfaceName}`);
      }
    }
    try {
      Db.reqClass = FakeDatabaseRequest;
      const database = new Db({ throwOnCode });
      const persistence = new NodeCloudBasePersistence({ database: () => database } as unknown as CloudBase);
      const expected = { failures: 5, blockedUntil: "2026-10-09T00:15:00.000Z" };

      await expect(persistence.recordLoginFailure("attempt-id", {
        now: "2026-10-09T00:00:00.000Z", maxFailures: 5, blockMilliseconds: 900_000
      })).resolves.toEqual(expected);

      expect(reads).toEqual([3, 4]);
      expect(writes).toEqual([{ failures: 4, blockedUntil: null }, expected]);
      expect(latest).toEqual(expected);
      expect(starts).toBe(2);
    } finally {
      Db.reqClass = originalRequestClass;
    }
  });

  it("stops after six installed SDK transaction callbacks and throws the last conflict when retries are exhausted", async () => {
    const testRequire = createRequire(import.meta.url);
    const nodeSdkRequire = createRequire(testRequire.resolve("@cloudbase/node-sdk/package.json"));
    const { Db } = nodeSdkRequire(nodeSdkRequire.resolve("@cloudbase/database")) as {
      Db: { new(config?: unknown): unknown; reqClass: unknown };
    };
    const originalRequestClass = Db.reqClass;
    const conflicts: Array<{ code: string; message: string; requestId: string }> = [];
    let starts = 0;
    let callbacks = 0;
    let reads = 0;
    let writes = 0;
    class FakeDatabaseRequest {
      async send(interfaceName: string): Promise<Record<string, unknown>> {
        if (interfaceName === "database.startTransaction") return { transactionId: `exhausted-login-${++starts}` };
        if (interfaceName === "database.getDocument") {
          reads += 1;
          return { data: { list: [] }, requestId: "read-login" };
        }
        if (interfaceName === "database.modifyDocument") {
          writes += 1;
          return { data: { updated: 0, upsert_id: "attempt-id" }, requestId: "write-login" };
        }
        if (interfaceName === "database.commitTransaction") {
          const conflict = {
            code: "DATABASE_TRANSACTION_CONFLICT", message: "concurrent failure",
            requestId: `conflict-login-${conflicts.length + 1}`
          };
          conflicts.push(conflict);
          return conflict;
        }
        if (interfaceName === "database.abortTransaction") return { requestId: "abort-login" };
        throw new Error(`unexpected installed database request: ${interfaceName}`);
      }
    }
    try {
      Db.reqClass = FakeDatabaseRequest;
      const database = new Db({ throwOnCode: false }) as {
        runTransaction(callback: (transaction: unknown) => Promise<unknown>, retries?: number): Promise<unknown>;
      };
      const installedRunTransaction = database.runTransaction.bind(database);
      database.runTransaction = (callback, retries) => installedRunTransaction(async (transaction) => {
        callbacks += 1;
        return callback(transaction);
      }, retries);
      const persistence = new NodeCloudBasePersistence({ database: () => database } as unknown as CloudBase);

      const result = await persistence.recordLoginFailure("attempt-id", {
        now: "2026-10-09T00:00:00.000Z", maxFailures: 5, blockMilliseconds: 900_000
      }).catch((error: unknown) => error);

      expect(starts).toBe(6);
      expect(callbacks).toBe(6);
      expect(reads).toBe(6);
      expect(writes).toBe(6);
      expect(conflicts).toHaveLength(6);
      expect(result).toBe(conflicts[5]);
    } finally {
      Db.reqClass = originalRequestClass;
    }
  });

  it("returns an exact Uint8Array view for a downloaded Buffer subarray", async () => {
    const source = Buffer.allocUnsafe(32);
    source.set([10, 20, 30, 40], 7);
    const content = source.subarray(7, 11);
    const downloadFile = vi.fn().mockResolvedValue({ fileContent: content, message: "ok" });
    const persistence = new NodeCloudBasePersistence({
      database: vi.fn(() => ({})),
      downloadFile
    } as unknown as CloudBase);

    const result = await persistence.downloadFile("cloud://private/image.jpg");

    expect(result).toEqual(new Uint8Array([10, 20, 30, 40]));
    expect(result.buffer).toBe(content.buffer);
    expect(result.byteOffset).toBe(content.byteOffset);
    expect(result.byteLength).toBe(content.byteLength);
    expect(downloadFile).toHaveBeenCalledExactlyOnceWith({ fileID: "cloud://private/image.jpg" });
  });

  it("encodes downloaded string content as UTF-8 bytes", async () => {
    const downloadFile = vi.fn().mockResolvedValue({ fileContent: "示例甲🙂", message: "ok" });
    const persistence = new NodeCloudBasePersistence({
      database: vi.fn(() => ({})),
      downloadFile
    } as unknown as CloudBase);

    await expect(persistence.downloadFile("cloud://private/text.txt")).resolves.toEqual(
      new TextEncoder().encode("示例甲🙂")
    );
  });

  it("throws fulfilled SDK errors from file downloads", async () => {
    const error = cloudBaseError("download failed");
    const downloadFile = vi.fn().mockResolvedValue(error);
    const persistence = new NodeCloudBasePersistence({
      database: vi.fn(() => ({})),
      downloadFile
    } as unknown as CloudBase);

    await expect(persistence.downloadFile("cloud://private/image.jpg")).rejects.toBe(error);
  });

  it.each([{}, { fileContent: undefined, message: "missing" }])(
    "rejects downloaded responses without file content",
    async (response) => {
      const downloadFile = vi.fn().mockResolvedValue(response);
      const persistence = new NodeCloudBasePersistence({
        database: vi.fn(() => ({})),
        downloadFile
      } as unknown as CloudBase);

      await expect(persistence.downloadFile("cloud://private/missing.jpg"))
        .rejects.toThrow("downloaded file content unavailable");
    }
  );

  it.each([null, "1001_a"])("queries pending mention document IDs after %s using metadata and the actual _id", async (afterId) => {
    const query = {
      orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ data: [{ _id: "1001_b", id: "forged-payload-id" }, { _id: "1002_c" }] })
    };
    const where = vi.fn(() => query);
    const database = { collection: vi.fn(() => ({ where })), command: { gt: vi.fn((value) => ({ gt: value })) } };
    const persistence = new NodeCloudBasePersistence({ database: () => database } as unknown as CloudBase);
    await expect(persistence.queryPendingWenliMentionIds(afterId, 20)).resolves.toEqual(["1001_b", "1002_c"]);
    expect(database.collection).toHaveBeenCalledWith("messages");
    expect(where).toHaveBeenCalledWith({ wenliMentionPending: true, ...(afterId === null ? {} : { _id: { gt: afterId } }) });
    expect(query.orderBy).toHaveBeenCalledExactlyOnceWith("_id", "asc");
    expect(query.limit).toHaveBeenCalledWith(20);
  });

  it("acknowledges only a pending message metadata field with a conditional update", async () => {
    const update = vi.fn().mockResolvedValue({ updated: 0, requestId: "ack-missing-or-already-done" });
    const where = vi.fn(() => ({ update }));
    const collection = vi.fn(() => ({ where }));
    const persistence = new NodeCloudBasePersistence({ database: () => ({ collection }) } as unknown as CloudBase);
    await expect(persistence.acknowledgeWenliMention("1001_source")).resolves.toBeUndefined();
    expect(collection).toHaveBeenCalledWith("messages");
    expect(where).toHaveBeenCalledWith({ _id: "1001_source", wenliMentionPending: true });
    expect(update).toHaveBeenCalledExactlyOnceWith({ wenliMentionPending: false });
  });

  it("propagates fulfilled SDK errors from pending-ID queries and acknowledgements", async () => {
    const error = cloudBaseError("outbox operation failed");
    const query = {
      orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue(error), update: vi.fn().mockResolvedValue(error)
    };
    const database = { collection: () => ({ where: () => query }) };
    const persistence = new NodeCloudBasePersistence({ database: () => database } as unknown as CloudBase);
    await expect(persistence.queryPendingWenliMentionIds(null, 50)).rejects.toBe(error);
    await expect(persistence.acknowledgeWenliMention("1001_source")).rejects.toBe(error);
  });

  it("uses the installed database runtime transaction collection API and callback result", async () => {
    const testRequire = createRequire(import.meta.url);
    const nodeSdkPackage = testRequire.resolve("@cloudbase/node-sdk/package.json");
    const nodeSdkRequire = createRequire(nodeSdkPackage);
    const databaseEntry = nodeSdkRequire.resolve("@cloudbase/database");
    const databaseRuntime = nodeSdkRequire(databaseEntry) as {
      Db: { new(config?: unknown): { runTransaction(callback: (transaction: unknown) => unknown): Promise<unknown> }; reqClass: unknown };
    };
    const { Db } = databaseRuntime;
    const originalRequestClass = Db.reqClass;
    const sentinel = { runtime: "transaction/index" };
    class FakeDatabaseRequest {
      async send(interfaceName: string): Promise<Record<string, unknown>> {
        if (interfaceName === "database.startTransaction") return { transactionId: "runtime-contract" };
        if (interfaceName === "database.commitTransaction") return { requestId: "commit-runtime-contract" };
        if (interfaceName === "database.abortTransaction") return { requestId: "abort-runtime-contract" };
        throw new Error(`unexpected installed database request: ${interfaceName}`);
      }
    }

    try {
      Db.reqClass = FakeDatabaseRequest;
      const database = new Db({});
      const result = await database.runTransaction((transaction: unknown) => {
        const runtimeTransaction = transaction as { collection(name: string): unknown };
        expect(typeof runtimeTransaction.collection).toBe("function");
        expect(runtimeTransaction.collection("moments")).toBeDefined();
        return sentinel;
      });

      expect(result).toBe(sentinel);
    } finally {
      Db.reqClass = originalRequestClass;
    }
  });

  it("treats transaction data null as an absent document", async () => {
    const set = vi.fn().mockResolvedValue({});
    const transaction = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ data: null }),
          set,
        })),
      })),
    };
    const database = {
      runTransaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };
    const app = { database: vi.fn(() => database) } as unknown as CloudBase;
    const persistence = new NodeCloudBasePersistence(app);
    const document = { id: "couple", memberIds: ["1001", "1002"] };

    await expect(persistence.putIfAbsent("relationships", "couple", document)).resolves.toEqual(document);
    expect(set).toHaveBeenCalledWith(document);
  });

  it("reports the atomic put-if-absent insertion status from the transaction", async () => {
    const insertedDocument = { accountId: "1001", displayName: "backup" };
    const insertTransaction = transactionDocument({ get: { data: null }, set: vi.fn().mockResolvedValue({}) });
    const insertDatabase = {
      runTransaction: vi.fn(async (callback: (value: typeof insertTransaction) => Promise<unknown>) =>
        callback(insertTransaction))
    };
    const insertPersistence = new NodeCloudBasePersistence(
      { database: vi.fn(() => insertDatabase) } as unknown as CloudBase
    );

    await expect(insertPersistence.putIfAbsentWithStatus("users", "1001", insertedDocument))
      .resolves.toEqual({ document: insertedDocument, inserted: true });

    const existingDocument = { accountId: "1001", displayName: "current" };
    const existingSet = vi.fn();
    const existingTransaction = transactionDocument({ get: { data: [existingDocument] }, set: existingSet });
    const existingDatabase = {
      runTransaction: vi.fn(async (callback: (value: typeof existingTransaction) => Promise<unknown>) =>
        callback(existingTransaction))
    };
    const existingPersistence = new NodeCloudBasePersistence(
      { database: vi.fn(() => existingDatabase) } as unknown as CloudBase
    );

    await expect(existingPersistence.putIfAbsentWithStatus("users", "1001", insertedDocument))
      .resolves.toEqual({ document: existingDocument, inserted: false });
    expect(existingSet).not.toHaveBeenCalled();
  });

  it("propagates resolved errors from direct document reads, writes, and exact removes", async () => {
    const readError = cloudBaseError("read failed");
    const readDatabase = {
      collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(readError) })) }))
    };
    const readPersistence = new NodeCloudBasePersistence(
      { database: vi.fn(() => readDatabase) } as unknown as CloudBase
    );
    await expect(readPersistence.getDocument("moments", "1001_m-1")).rejects.toBe(readError);

    const writeError = cloudBaseError("write failed");
    const writeDatabase = {
      collection: vi.fn(() => ({ doc: vi.fn(() => ({ set: vi.fn().mockResolvedValue(writeError) })) }))
    };
    const writePersistence = new NodeCloudBasePersistence(
      { database: vi.fn(() => writeDatabase) } as unknown as CloudBase
    );
    await expect(writePersistence.putDocument("moments", "1001_m-1", { id: "1001_m-1" }))
      .rejects.toBe(writeError);

    for (const collection of ["moments", "momentLikes", "momentComments", "login_attempts"] as const) {
      const removeError = cloudBaseError(`${collection} remove failed`);
      const removeDatabase = {
        collection: vi.fn(() => ({ doc: vi.fn(() => ({ remove: vi.fn().mockResolvedValue(removeError) })) }))
      };
      const removePersistence = new NodeCloudBasePersistence(
        { database: vi.fn(() => removeDatabase) } as unknown as CloudBase
      );
      await expect(removePersistence.removeDocument(collection, "target-id")).rejects.toBe(removeError);
    }
  });

  it("resolves a CloudBase storage path to its file ID before requesting a temporary URL", async () => {
    const getUploadMetadata = vi.fn().mockResolvedValue({
      data: { fileId: "cloud://env.bucket/releases/between-6.apk" }
    });
    const getTempFileURL = vi.fn().mockResolvedValue({
      fileList: [{
        fileID: "cloud://env.bucket/releases/between-6.apk",
        code: "SUCCESS",
        tempFileURL: "https://download.test/between-6.apk"
      }]
    });
    const persistence = new NodeCloudBasePersistence({
      database: vi.fn(() => ({})),
      getUploadMetadata,
      getTempFileURL
    } as unknown as CloudBase);

    await expect(persistence.temporaryUrl("releases/between-6.apk"))
      .resolves.toBe("https://download.test/between-6.apk");
    expect(getUploadMetadata).toHaveBeenCalledWith({ cloudPath: "releases/between-6.apk" });
    expect(getTempFileURL).toHaveBeenCalledWith({
      fileList: [{ fileID: "cloud://env.bucket/releases/between-6.apk", maxAge: 24 * 60 * 60 }]
    });
  });

  it("uses an existing CloudBase file ID directly for avatar temporary URLs", async () => {
    const getUploadMetadata = vi.fn();
    const getTempFileURL = vi.fn().mockResolvedValue({
      fileList: [{
        fileID: "cloud://env.bucket/avatars/1001.webp",
        code: "SUCCESS",
        tempFileURL: "https://download.test/1001.webp"
      }]
    });
    const persistence = new NodeCloudBasePersistence({
      database: vi.fn(() => ({})),
      getUploadMetadata,
      getTempFileURL
    } as unknown as CloudBase);

    await expect(persistence.temporaryUrl("cloud://env.bucket/avatars/1001.webp"))
      .resolves.toBe("https://download.test/1001.webp");
    expect(getUploadMetadata).not.toHaveBeenCalled();
  });

  it("never creates from a resolved putIfAbsent read error and propagates its resolved write error", async () => {
    const readError = cloudBaseError("putIfAbsent read failed");
    const readSet = vi.fn().mockResolvedValue({ updated: 1, requestId: "unexpected-set" });
    const readTransaction = transactionDocument({ get: readError, set: readSet });
    const readDatabase = {
      runTransaction: vi.fn(async (callback: (value: typeof readTransaction) => Promise<unknown>) =>
        callback(readTransaction))
    };
    const readPersistence = new NodeCloudBasePersistence(
      { database: vi.fn(() => readDatabase) } as unknown as CloudBase
    );
    await expect(readPersistence.putIfAbsent("moments", "1001_m-1", { id: "1001_m-1" }))
      .rejects.toBe(readError);
    expect(readSet).not.toHaveBeenCalled();

    const writeError = cloudBaseError("putIfAbsent set failed");
    const writeSet = vi.fn().mockResolvedValue(writeError);
    const writeTransaction = transactionDocument({ get: { data: null }, set: writeSet });
    const writeDatabase = {
      runTransaction: vi.fn(async (callback: (value: typeof writeTransaction) => Promise<unknown>) =>
        callback(writeTransaction))
    };
    const writePersistence = new NodeCloudBasePersistence(
      { database: vi.fn(() => writeDatabase) } as unknown as CloudBase
    );
    await expect(writePersistence.putIfAbsent("moments", "1001_m-1", { id: "1001_m-1" }))
      .rejects.toBe(writeError);
    expect(writeSet).toHaveBeenCalledTimes(1);
  });

  it("initializes both pending user documents in one transaction", async () => {
    const documents = new Map([
      ["1001", { accountId: "1001", profileInitializedVersion: 0, passwordHash: "latest-1001" }],
      ["1002", { accountId: "1002", profileInitializedVersion: 0, passwordHash: "latest-1002" }]
    ]);
    const transaction = transactionFor(documents);
    const database = {
      runTransaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction))
    };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.initializeUserProfilesIfNeeded(initialFields())).resolves.toMatchObject({
      initializedAccounts: ["1001", "1002"],
      documents: [{ profileInitializedVersion: 1 }, { profileInitializedVersion: 1 }]
    });
    expect(database.runTransaction).toHaveBeenCalledTimes(1);
  });

  it("rolls back the first staged document when the second transaction write fails", async () => {
    const committed = new Map([
      ["1001", { accountId: "1001", profileInitializedVersion: 0 }],
      ["1002", { accountId: "1002", profileInitializedVersion: 0 }]
    ]);
    const database = rollbackDatabase(committed);
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.initializeUserProfilesIfNeeded(initialFields())).rejects.toThrow("second write failed");
    expect(committed.get("1001")).toMatchObject({ profileInitializedVersion: 0 });
    expect(committed.get("1002")).toMatchObject({ profileInitializedVersion: 0 });
  });

  it("patches only scoped user fields using a transaction update", async () => {
    const latest = { accountId: "1001", profileInitializedVersion: 1, sessionVersion: 4, displayName: "chosen" };
    const update = vi.fn().mockResolvedValue({});
    const transaction = {
      collection: vi.fn(() => ({ doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ data: latest }), update
      })) }))
    };
    const database = {
      runTransaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction))
    };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.patchUserDocument("1001", { sessionHash: "new" }, true)).resolves.toEqual({
      ...latest,
      sessionHash: "new",
      sessionVersion: 5
    });
    expect(update).toHaveBeenCalledWith({ sessionHash: "new", sessionVersion: 5 });
  });

  it("advances a message receipt atomically without erasing legacy read fields", async () => {
    const existing = {
      accountId: "1001",
      lastReadMessageId: "1002_legacy",
      lastReadMessageCreatedAt: "2026-08-08T00:00:00.000Z",
      lastSeenMomentAt: "2026-08-08T00:00:00.000Z",
      readReceiptMessageId: "1002_a",
      readReceiptMessageCreatedAt: "2026-08-09T00:00:01.000Z",
      updatedAt: "old"
    };
    const get = vi.fn()
      .mockResolvedValueOnce({ data: existing })
      .mockResolvedValueOnce({ data: { ...existing, readReceiptMessageId: "1002_b", readReceiptMessageCreatedAt: "2026-08-09T00:00:02.000Z" } });
    const update = vi.fn().mockResolvedValue({ updated: 1 });
    const set = vi.fn().mockResolvedValue({ upserted: [{ _id: "1001" }] });
    const transaction = {
      collection: vi.fn(() => ({ doc: vi.fn(() => ({ get, update, set })) }))
    };
    const database = {
      runTransaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction))
    };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.advanceReadState(
      "1001",
      { id: "1002_b", createdAt: "2026-08-09T00:00:02.000Z" },
      "new"
    )).resolves.toMatchObject({
      lastReadMessageId: "1002_legacy",
      lastSeenMomentAt: "2026-08-08T00:00:00.000Z",
      readReceiptMessageId: "1002_b"
    });
    await expect(persistence.advanceReadState(
      "1001",
      { id: "1002_a", createdAt: "2026-08-09T00:00:01.000Z" },
      "older"
    )).resolves.toMatchObject({ readReceiptMessageId: "1002_b" });
    expect(update).toHaveBeenCalledExactlyOnceWith({
      readReceiptMessageId: "1002_b",
      readReceiptMessageCreatedAt: "2026-08-09T00:00:02.000Z",
      updatedAt: "new"
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("merges legacy read fields atomically without erasing the receipt", async () => {
    const existing = {
      accountId: "1001",
      readReceiptMessageId: "1002_b",
      readReceiptMessageCreatedAt: "2026-08-09T00:00:02.000Z",
      lastSeenMomentAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "old"
    };
    const get = vi.fn().mockResolvedValue({ data: existing });
    const update = vi.fn().mockResolvedValue({ updated: 1 });
    const set = vi.fn().mockResolvedValue({ upserted: [{ _id: "1001" }] });
    const transaction = {
      collection: vi.fn(() => ({ doc: vi.fn(() => ({ get, update, set })) }))
    };
    const database = {
      runTransaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction))
    };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.patchReadState(
      "1001",
      { lastSeenMomentAt: "2026-08-09T00:00:00.000Z" },
      "new"
    )).resolves.toMatchObject({
      readReceiptMessageId: "1002_b",
      lastSeenMomentAt: "2026-08-09T00:00:00.000Z"
    });
    expect(update).toHaveBeenCalledExactlyOnceWith({
      lastSeenMomentAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "new"
    });
    expect(set).not.toHaveBeenCalled();
  });

  it.each([
    { lastReadMessageId: "1002_a", lastReadMessageCreatedAt: "2026-08-09T00:00:02.000Z" },
    { lastReadMessageId: "1002_c", lastReadMessageCreatedAt: "2026-08-09T00:00:01.000Z" },
    { lastSeenMomentAt: "2026-08-08T00:00:00.000Z" }
  ])("rejects a stale read-state patch against the transaction's latest state: %j", async (patch) => {
    const existing = {
      accountId: "1001",
      lastReadMessageId: "1002_b",
      lastReadMessageCreatedAt: "2026-08-09T00:00:02.000Z",
      lastSeenMomentAt: "2026-08-09T00:00:00.000Z",
      readReceiptMessageId: "1002_b",
      readReceiptMessageCreatedAt: "2026-08-09T00:00:02.000Z",
      updatedAt: "old"
    };
    const update = vi.fn().mockResolvedValue({ updated: 1 });
    const transaction = {
      collection: vi.fn(() => ({ doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ data: existing }), update
      })) }))
    };
    const database = {
      runTransaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction))
    };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.patchReadState("1001", patch, "new"))
      .rejects.toMatchObject({ code: "READ_STATE_BEHIND" });
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the newer unread position when the installed SDK retries a transaction conflict", async () => {
    const testRequire = createRequire(import.meta.url);
    const nodeSdkRequire = createRequire(testRequire.resolve("@cloudbase/node-sdk/package.json"));
    const { Db } = nodeSdkRequire(nodeSdkRequire.resolve("@cloudbase/database")) as {
      Db: { new(config?: unknown): unknown; reqClass: unknown };
    };
    const originalRequestClass = Db.reqClass;
    const requested: string[] = [];
    const createdAt = "2026-08-09T00:00:02.000Z";
    const latest = { accountId: "1001", lastReadMessageId: "1002_z", lastReadMessageCreatedAt: createdAt };
    let attempts = 0;
    class FakeDatabaseRequest {
      async send(interfaceName: string): Promise<Record<string, unknown>> {
        requested.push(interfaceName);
        if (interfaceName === "database.startTransaction") {
          attempts += 1;
          return { transactionId: `read-state-${attempts}` };
        }
        if (interfaceName === "database.getDocument") {
          const document = attempts === 1 ? { ...latest, lastReadMessageId: "1002_a" } : latest;
          return { data: { list: [JSON.stringify(document)] } };
        }
        if (interfaceName === "database.modifyDocument") return { data: { updated: 1 } };
        if (interfaceName === "database.commitTransaction") return { code: "DATABASE_TRANSACTION_CONFLICT" };
        if (interfaceName === "database.abortTransaction") return { requestId: "aborted-stale-read-state" };
        throw new Error(`unexpected installed database request: ${interfaceName}`);
      }
    }

    try {
      Db.reqClass = FakeDatabaseRequest;
      const database = new Db({});
      const persistence = new NodeCloudBasePersistence({ database: () => database } as unknown as CloudBase);

      await expect(persistence.patchReadState("1001", {
        lastReadMessageId: "1002_b", lastReadMessageCreatedAt: createdAt
      }, "new")).rejects.toMatchObject({ name: "AppError", code: "READ_STATE_BEHIND" });
      expect(requested).toEqual([
        "database.startTransaction", "database.getDocument", "database.modifyDocument",
        "database.commitTransaction", "database.startTransaction", "database.getDocument",
        "database.abortTransaction"
      ]);
    } finally {
      Db.reqClass = originalRequestClass;
    }
  });

  it("filters visible non-deleting moments before applying descending feed order and limit", async () => {
    const operations: Array<{ name: string; value: unknown }> = [];
    const or = vi.fn((conditions: unknown[]) => ({ operator: "or", conditions }));
    const and = vi.fn((conditions: unknown[]) => ({ operator: "and", conditions }));
    const query = {
      where: vi.fn((condition: unknown) => {
        operations.push({ name: "where", value: condition });
        return query;
      }),
      orderBy: vi.fn((field: string, direction: string) => {
        operations.push({ name: "orderBy", value: [field, direction] });
        return query;
      }),
      limit: vi.fn((value: number) => {
        operations.push({ name: "limit", value });
        return query;
      }),
      get: vi.fn(async () => ({ data: [{ _id: "ignored", id: "1001_m-1" }] }))
    };
    const database = {
      command: { or, and },
      collection: vi.fn(() => query)
    };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.queryLatestVisibleMoments("1001", 50)).resolves.toEqual([{ id: "1001_m-1" }]);

    expect(or).toHaveBeenCalledWith([{ visibility: "PARTNER" }, { authorId: "1001" }]);
    expect(and).toHaveBeenCalledWith([
      { deleting: false },
      { operator: "or", conditions: [{ visibility: "PARTNER" }, { authorId: "1001" }] }
    ]);
    expect(operations).toEqual([
      {
        name: "where",
        value: {
          operator: "and",
          conditions: [
            { deleting: false },
            { operator: "or", conditions: [{ visibility: "PARTNER" }, { authorId: "1001" }] }
          ]
        }
      },
      { name: "orderBy", value: ["createdAt", "desc"] },
      { name: "orderBy", value: ["id", "desc"] },
      { name: "limit", value: 50 }
    ]);
  });

  it("queries recent active Wenli memories with descending update/id order and a 200-row ceiling", async () => {
    const operations: Array<{ name: string; value: unknown }> = [];
    const query = {
      where: vi.fn((condition: unknown) => {
        operations.push({ name: "where", value: condition });
        return query;
      }),
      orderBy: vi.fn((field: string, direction: string) => {
        operations.push({ name: "orderBy", value: [field, direction] });
        return query;
      }),
      limit: vi.fn((value: number) => {
        operations.push({ name: "limit", value });
        return query;
      }),
      get: vi.fn(async () => ({
        data: [
          { _id: "mem_recent_2", id: "mem_recent_2", status: "active" },
          { _id: "mem_recent_1", status: "active" }
        ]
      }))
    };
    const database = { collection: vi.fn(() => query) };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.queryWenliMemories(500)).resolves.toEqual([
      { id: "mem_recent_2", data: { id: "mem_recent_2", status: "active" } },
      { id: "mem_recent_1", data: { status: "active" } }
    ]);

    expect(database.collection).toHaveBeenCalledExactlyOnceWith("wenliMemories");
    expect(operations).toEqual([
      { name: "orderBy", value: ["updatedAt", "desc"] },
      { name: "orderBy", value: ["_id", "desc"] },
      { name: "limit", value: 200 }
    ]);
  });

  it("propagates resolved CloudBase errors from recent Wenli memory queries", async () => {
    const error = cloudBaseError("Wenli memory query failed");
    const query = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn().mockResolvedValue(error)
    };
    const database = { collection: vi.fn(() => query) };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.queryWenliMemories(200)).rejects.toBe(error);
  });

  it("queries relations in deterministic command.in chunks of ten and skips empty batches", async () => {
    const chunks: string[][] = [];
    const commandIn = vi.fn((values: string[]) => ({ operator: "in", values }));
    const database = {
      command: { in: commandIn },
      collection: vi.fn((collection: string) => ({
        where: vi.fn((condition: { momentId: { values: string[] } }) => {
          chunks.push([...condition.momentId.values]);
          const query = {
            orderBy: vi.fn(() => query),
            skip: vi.fn(() => query),
            limit: vi.fn(() => query),
            get: vi.fn(async () => ({
              data: condition.momentId.values.map((momentId) => {
                return { _id: `sdk-${momentId}`, id: `like-${momentId}`, momentId };
              })
            }))
          };
          return query;
        })
      }))
    };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);
    const momentIds = Array.from({ length: 23 }, (_, index) => `moment-${String(index).padStart(2, "0")}`);

    await expect(persistence.queryMomentRelations("momentLikes", [])).resolves.toEqual([]);
    await expect(persistence.queryMomentRelations("momentLikes", momentIds)).resolves.toEqual(
      momentIds.map((momentId) => ({ id: `like-${momentId}`, momentId }))
    );

    expect(database.collection).toHaveBeenCalledTimes(3);
    expect(database.collection).toHaveBeenCalledWith("momentLikes");
    expect(commandIn).toHaveBeenCalledTimes(3);
    expect(chunks).toEqual([momentIds.slice(0, 10), momentIds.slice(10, 20), momentIds.slice(20)]);
  });

  it("paginates every relation chunk in stable order without truncating more than one hundred comments", async () => {
    const momentId = "1001_m-1";
    const documents = Array.from({ length: 205 }, (_, index) => ({
      _id: `sdk-comment-${index}`,
      id: `1001_comment-${String(index).padStart(3, "0")}`,
      momentId,
      createdAt: `2026-08-07T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`
    }));
    const pageCalls: Array<{
      orders: Array<[string, string]>;
      skip: number;
      limit: number;
    }> = [];
    const commandIn = vi.fn((values: string[]) => ({ operator: "in", values }));
    const database = {
      command: { in: commandIn },
      collection: vi.fn(() => ({
        where: vi.fn(() => relationPageQuery(documents, pageCalls))
      }))
    };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.queryMomentRelations("momentComments", [momentId])).resolves.toEqual(
      documents.map(({ _id, ...document }) => document)
    );

    expect(commandIn).toHaveBeenCalledWith([momentId]);
    expect(pageCalls).toEqual([0, 100, 200].map((skip) => ({
      orders: [["createdAt", "asc"], ["id", "asc"]],
      skip,
      limit: 100
    })));
  });

  it("bounds Agent comment lookup to one recent page instead of reading the entire thread", async () => {
    const query = {
      orderBy: vi.fn(), skip: vi.fn(), limit: vi.fn(),
      get: vi.fn().mockResolvedValue({ data: [{ _id: "sdk-c", id: "1001_c", momentId: "1001_m" }] })
    };
    query.orderBy.mockReturnValue(query);
    query.skip.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const database = {
      command: { in: vi.fn((ids: string[]) => ({ ids })) },
      collection: vi.fn(() => ({ where: vi.fn(() => query) }))
    };
    const persistence = new NodeCloudBasePersistence({ database: () => database } as unknown as CloudBase);

    await expect(persistence.queryMomentRelations("momentComments", ["1001_m"], 8)).resolves.toEqual([
      { id: "1001_c", momentId: "1001_m" }
    ]);
    expect(query.limit).toHaveBeenCalledWith(8);
    expect(query.orderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(query.skip).not.toHaveBeenCalled();
    expect(query.get).toHaveBeenCalledTimes(1);
  });

  it("removes only relations matching the target moment, likes before comments", async () => {
    const operations: Array<{ collection: string; condition?: unknown; removed?: true }> = [];
    const database = {
      collection: vi.fn((collection: string) => ({
        where: vi.fn((condition: unknown) => {
          operations.push({ collection, condition });
          return {
            remove: vi.fn(async () => {
              operations.push({ collection, removed: true });
              return { deleted: 1, requestId: `remove-${collection}` };
            })
          };
        })
      }))
    };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.removeMomentRelations("1001_m-1")).resolves.toBeUndefined();

    expect(operations).toEqual([
      { collection: "momentLikes", condition: { momentId: "1001_m-1" } },
      { collection: "momentLikes", removed: true },
      { collection: "momentComments", condition: { momentId: "1001_m-1" } },
      { collection: "momentComments", removed: true }
    ]);
  });

  it("throws a resolved CloudBase error from like cleanup before removing comments", async () => {
    const likeRemove = vi.fn().mockResolvedValue({
      code: "DATABASE_REQUEST_FAILED",
      message: "like cleanup failed",
      requestId: "like-error"
    });
    const commentRemove = vi.fn().mockResolvedValue({ deleted: 1, requestId: "comment-success" });
    const database = relationRemovalDatabase(likeRemove, commentRemove);
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.removeMomentRelations("1001_m-1")).rejects.toMatchObject({
      code: "DATABASE_REQUEST_FAILED",
      message: "like cleanup failed"
    });
    expect(likeRemove).toHaveBeenCalledTimes(1);
    expect(commentRemove).not.toHaveBeenCalled();
  });

  it("throws a resolved CloudBase error from comment cleanup", async () => {
    const likeRemove = vi.fn().mockResolvedValue({ deleted: 1, requestId: "like-success" });
    const commentRemove = vi.fn().mockResolvedValue({
      code: "DATABASE_REQUEST_FAILED",
      message: "comment cleanup failed",
      requestId: "comment-error"
    });
    const database = relationRemovalDatabase(likeRemove, commentRemove);
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.removeMomentRelations("1001_m-1")).rejects.toMatchObject({
      code: "DATABASE_REQUEST_FAILED",
      message: "comment cleanup failed"
    });
    expect(likeRemove).toHaveBeenCalledTimes(1);
    expect(commentRemove).toHaveBeenCalledTimes(1);
  });

  it("atomically returns null for unavailable moments, returns retries, and inserts a relation once", async () => {
    const relation = {
      id: "1001_m-1_1002",
      momentId: "1001_m-1",
      accountId: "1002" as const,
      createdAt: "2026-08-07T00:00:00.000Z"
    };
    const visibleMoment = {
      id: "1001_m-1",
      authorId: "1001",
      clientMomentId: "m-1",
      visibility: "PARTNER",
      deleting: false
    };

    for (const unavailable of [
      null,
      { ...visibleMoment, deleting: true },
      { ...visibleMoment, visibility: "SELF" }
    ]) {
      const harness = interactionDatabase(unavailable, null);
      const persistence = new NodeCloudBasePersistence(
        { database: vi.fn(() => harness.database) } as unknown as CloudBase
      );
      await expect(persistence.appendMomentRelationIfVisible(
        "momentLikes", relation.id, relation.momentId, relation.accountId, relation
      )).resolves.toBeNull();
      expect(harness.references).toEqual([{ collection: "moments", id: relation.momentId, operation: "get" }]);
    }

    const existing = { ...relation, createdAt: "2026-08-06T00:00:00.000Z" };
    const retryHarness = interactionDatabase(visibleMoment, existing);
    const retryPersistence = new NodeCloudBasePersistence(
      { database: vi.fn(() => retryHarness.database) } as unknown as CloudBase
    );
    await expect(retryPersistence.appendMomentRelationIfVisible(
      "momentLikes", relation.id, relation.momentId, relation.accountId, relation
    )).resolves.toEqual(existing);
    expect(retryHarness.references).toEqual([
      { collection: "moments", id: relation.momentId, operation: "get" },
      { collection: "momentLikes", id: relation.id, operation: "get" }
    ]);

    const insertHarness = interactionDatabase({ ...visibleMoment, interactionVersion: 7 }, null);
    const insertPersistence = new NodeCloudBasePersistence(
      { database: vi.fn(() => insertHarness.database) } as unknown as CloudBase
    );
    await expect(insertPersistence.appendMomentRelationIfVisible(
      "momentLikes", relation.id, relation.momentId, relation.accountId, relation
    )).resolves.toEqual(relation);
    expect(insertHarness.references).toEqual([
      { collection: "moments", id: relation.momentId, operation: "get" },
      { collection: "momentLikes", id: relation.id, operation: "get" },
      {
        collection: "moments",
        id: relation.momentId,
        operation: "update",
        data: { interactionVersion: 8 }
      },
      { collection: "momentLikes", id: relation.id, operation: "set" }
    ]);
    expect(insertHarness.runTransaction).toHaveBeenCalledTimes(1);
  });

  it("rereads the moment when the SDK retries a transaction conflict so deletion can win", async () => {
    const relation = {
      id: "1001_m-1_1002",
      momentId: "1001_m-1",
      accountId: "1002" as const,
      createdAt: "2026-08-07T00:00:00.000Z"
    };
    const visibleMoment = {
      id: "1001_m-1",
      authorId: "1001",
      clientMomentId: "m-1",
      visibility: "PARTNER",
      deleting: false
    };
    const firstAttempt = interactionDatabase(visibleMoment, null);
    const retryAttempt = interactionDatabase({ ...visibleMoment, deleting: true }, null);
    const runTransaction = vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => {
      await callback(firstAttempt.transaction);
      return callback(retryAttempt.transaction);
    });
    const persistence = new NodeCloudBasePersistence({
      database: vi.fn(() => ({ runTransaction }))
    } as unknown as CloudBase);

    await expect(persistence.appendMomentRelationIfVisible(
      "momentLikes", relation.id, relation.momentId, relation.accountId, relation
    )).resolves.toBeNull();

    expect(firstAttempt.references).toEqual([
      { collection: "moments", id: relation.momentId, operation: "get" },
      { collection: "momentLikes", id: relation.id, operation: "get" },
      {
        collection: "moments",
        id: relation.momentId,
        operation: "update",
        data: { interactionVersion: 1 }
      },
      { collection: "momentLikes", id: relation.id, operation: "set" }
    ]);
    expect(retryAttempt.references).toEqual([
      { collection: "moments", id: relation.momentId, operation: "get" }
    ]);
  });

  it("propagates resolved parent-version and relation-set errors from atomic interaction writes", async () => {
    const relation = {
      id: "1001_m-1_1002",
      momentId: "1001_m-1",
      accountId: "1002" as const,
      createdAt: "2026-08-07T00:00:00.000Z"
    };
    const visibleMoment = {
      id: relation.momentId,
      authorId: "1001",
      visibility: "PARTNER",
      deleting: false,
      interactionVersion: 0
    };
    const updateError = cloudBaseError("parent version update failed");
    const updateHarness = interactionDatabase(visibleMoment, null, { momentUpdate: updateError });
    const updatePersistence = new NodeCloudBasePersistence(
      { database: vi.fn(() => updateHarness.database) } as unknown as CloudBase
    );
    await expect(updatePersistence.appendMomentRelationIfVisible(
      "momentLikes", relation.id, relation.momentId, relation.accountId, relation
    )).rejects.toBe(updateError);
    expect(updateHarness.references).not.toContainEqual({
      collection: "momentLikes", id: relation.id, operation: "set"
    });

    const setError = cloudBaseError("relation set failed");
    const setHarness = interactionDatabase(visibleMoment, null, { relationSet: setError });
    const setPersistence = new NodeCloudBasePersistence(
      { database: vi.fn(() => setHarness.database) } as unknown as CloudBase
    );
    await expect(setPersistence.appendMomentRelationIfVisible(
      "momentLikes", relation.id, relation.momentId, relation.accountId, relation
    )).rejects.toBe(setError);
  });

  it("propagates a resolved deletion-marker update error", async () => {
    const updateError = cloudBaseError("deletion marker failed");
    const update = vi.fn().mockResolvedValue(updateError);
    const transaction = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ data: { id: "1001_m-1", deleting: false } }),
          update
        }))
      }))
    };
    const database = {
      runTransaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction))
    };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.markMomentDeleting("1001_m-1")).rejects.toBe(updateError);
    expect(update).toHaveBeenCalledWith({ deleting: true });
  });

  it("marks only the existing server moment deleting inside a transaction and ignores missing records", async () => {
    const update = vi.fn().mockResolvedValue({ updated: 1, requestId: "mark" });
    const get = vi.fn()
      .mockResolvedValueOnce({ data: { id: "1001_m-1", body: "server-owned", deleting: false } })
      .mockResolvedValueOnce({ data: null });
    const transaction = {
      collection: vi.fn((collection: string) => ({
        doc: vi.fn((id: string) => ({ get, update, collection, id }))
      }))
    };
    const database = {
      runTransaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction))
    };
    const persistence = new NodeCloudBasePersistence({ database: vi.fn(() => database) } as unknown as CloudBase);

    await expect(persistence.markMomentDeleting("1001_m-1")).resolves.toBeUndefined();
    await expect(persistence.markMomentDeleting("missing")).resolves.toBeUndefined();

    expect(database.runTransaction).toHaveBeenCalledTimes(2);
    expect(transaction.collection).toHaveBeenCalledWith("moments");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ deleting: true });
  });

  it("uses three narrow ordered due-job queries, globally merges them, and never scans terminal jobs", async () => {
    const now = "2026-08-31T00:00:00.000Z";
    const due = dueQueryDatabase([
      { data: [{ _id: "1001_later", id: "1001_later", status: "pending", nextAttemptAt: "2026-08-31T00:01:00.000Z" }] },
      { data: [{ _id: "1001_retry", id: "1001_retry", status: "retry", nextAttemptAt: now }] },
      { data: [{ _id: "1002_expired", id: "1002_expired", status: "running", leaseUntil: now }] }
    ]);
    const persistence = new NodeCloudBasePersistence({ database: () => due.database } as unknown as CloudBase);

    await expect(persistence.queryDueWenliAgentJobs(now, 2)).resolves.toEqual([
      { id: "1001_retry", status: "retry", nextAttemptAt: now },
      { id: "1002_expired", status: "running", leaseUntil: now }
    ]);

    expect(due.collection).toHaveBeenCalledTimes(3);
    expect(due.collection).toHaveBeenNthCalledWith(1, "wenliAgentJobs");
    expect(due.collection).toHaveBeenNthCalledWith(2, "wenliAgentJobs");
    expect(due.collection).toHaveBeenNthCalledWith(3, "wenliAgentJobs");
    expect(due.lte).toHaveBeenCalledTimes(3);
    expect(due.lte).toHaveBeenNthCalledWith(1, now);
    expect(due.lte).toHaveBeenNthCalledWith(2, now);
    expect(due.lte).toHaveBeenNthCalledWith(3, now);
    expect(due.queries.map(({ where }) => where.mock.calls[0]![0])).toEqual([
      { status: "pending", nextAttemptAt: { lte: now } },
      { status: "retry", nextAttemptAt: { lte: now } },
      { status: "running", leaseUntil: { lte: now } }
    ]);
    expect(due.queries.map(({ orderBy }) => orderBy.mock.calls)).toEqual([
      [["nextAttemptAt", "asc"], ["_id", "asc"]],
      [["nextAttemptAt", "asc"], ["_id", "asc"]],
      [["leaseUntil", "asc"], ["_id", "asc"]]
    ]);
    expect(due.queries.map(({ limit }) => limit.mock.calls)).toEqual([[[2]], [[2]], [[2]]]);
    expect(due.scanDocuments).not.toHaveBeenCalled();
  });

  it("rejects mismatched due-job payload IDs and fulfilled CloudBase error envelopes", async () => {
    const conflict = dueQueryDatabase([
      { data: [{ _id: "1001_actual", id: "forged", status: "pending", nextAttemptAt: "2026-08-31T00:00:00.000Z" }] },
      { data: [] }, { data: [] }
    ]);
    const conflictPersistence = new NodeCloudBasePersistence({ database: () => conflict.database } as unknown as CloudBase);
    await expect(conflictPersistence.queryDueWenliAgentJobs("2026-08-31T00:00:00.000Z", 1)).rejects.toThrow("invalid Wenli due document");

    const error = cloudBaseError("due query failed");
    const failed = dueQueryDatabase([error, { data: [] }, { data: [] }]);
    const failedPersistence = new NodeCloudBasePersistence({ database: () => failed.database } as unknown as CloudBase);
    await expect(failedPersistence.queryDueWenliAgentJobs("2026-08-31T00:00:00.000Z", 1)).rejects.toBe(error);
  });

  it("rejects an invalid due-query time before touching CloudBase", async () => {
    const due = dueQueryDatabase([{ data: [] }, { data: [] }, { data: [] }]);
    const persistence = new NodeCloudBasePersistence({ database: () => due.database } as unknown as CloudBase);

    await expect(persistence.queryDueWenliAgentJobs("not-an-iso-time", 1)).rejects.toThrow("invalid Wenli argument");
    expect(due.collection).not.toHaveBeenCalled();
    expect(due.lte).not.toHaveBeenCalled();
  });
});

function dueQueryDatabase(results: unknown[]) {
  const queries = results.map((result) => {
    const query = { orderBy: vi.fn(), limit: vi.fn(), get: vi.fn().mockResolvedValue(result) };
    query.orderBy.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    return { where: vi.fn().mockReturnValue(query), ...query };
  });
  let index = 0;
  const collection = vi.fn(() => queries[index++]!);
  const lte = vi.fn((value: string) => ({ lte: value }));
  const scanDocuments = vi.fn();
  return { database: { collection, command: { lte }, scanDocuments }, collection, lte, queries, scanDocuments };
}

function interactionDatabase(
  moment: Record<string, unknown> | null,
  relation: Record<string, unknown> | null,
  resolvedErrors: {
    momentUpdate?: Record<string, unknown>;
    relationSet?: Record<string, unknown>;
  } = {}
) {
  const references: Array<{
    collection: string;
    id: string;
    operation: "get" | "set" | "update";
    data?: Record<string, unknown>;
  }> = [];
  const transaction = {
    collection: vi.fn((collection: string) => ({
      doc: vi.fn((id: string) => ({
        get: vi.fn(async () => {
          references.push({ collection, id, operation: "get" });
          return { data: structuredClone(collection === "moments" ? moment : relation) };
        }),
        set: vi.fn(async () => {
          references.push({ collection, id, operation: "set" });
          return resolvedErrors.relationSet ?? {
            updated: 0,
            upserted: [{ _id: id }],
            requestId: `set-${id}`
          };
        }),
        update: vi.fn(async (data: Record<string, unknown>) => {
          references.push({ collection, id, operation: "update", data: structuredClone(data) });
          return resolvedErrors.momentUpdate ?? { updated: 1, requestId: `update-${id}` };
        })
      }))
    }))
  };
  const runTransaction = vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction));
  return { database: { runTransaction }, transaction, runTransaction, references };
}

function cloudBaseError(message: string) {
  return { code: "DATABASE_REQUEST_FAILED", message, requestId: `error-${message}` };
}

function transactionDocument(options: {
  get: Record<string, unknown>;
  set: ReturnType<typeof vi.fn>;
}) {
  return {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue(options.get),
        set: options.set
      }))
    }))
  };
}

function relationRemovalDatabase(
  likeRemove: ReturnType<typeof vi.fn>,
  commentRemove: ReturnType<typeof vi.fn>
) {
  return {
    collection: vi.fn((collection: string) => ({
      where: vi.fn(() => ({
        remove: collection === "momentLikes" ? likeRemove : commentRemove
      }))
    }))
  };
}

function relationPageQuery(
  documents: Record<string, unknown>[],
  pageCalls: Array<{ orders: Array<[string, string]>; skip: number; limit: number }>,
  orders: Array<[string, string]> = [],
  skip = 0,
  limit = 100
) {
  return {
    orderBy(field: string, direction: string) {
      return relationPageQuery(documents, pageCalls, [...orders, [field, direction]], skip, limit);
    },
    skip(value: number) {
      return relationPageQuery(documents, pageCalls, orders, value, limit);
    },
    limit(value: number) {
      return relationPageQuery(documents, pageCalls, orders, skip, value);
    },
    async get() {
      pageCalls.push({ orders: structuredClone(orders), skip, limit });
      return { data: structuredClone(documents.slice(skip, skip + limit)) };
    }
  };
}

function transactionFor(documents: Map<string, Record<string, unknown>>) {
  return {
    collection: vi.fn(() => ({
      doc: vi.fn((id: string) => ({
        get: vi.fn().mockResolvedValue({ data: structuredClone(documents.get(id)) }),
        set: vi.fn(async (document: Record<string, unknown>) => { documents.set(id, structuredClone(document)); })
      }))
    }))
  };
}

function rollbackDatabase(committed: Map<string, Record<string, unknown>>) {
  return {
    runTransaction: vi.fn(async (callback: (transaction: ReturnType<typeof transactionFor>) => unknown) => {
      const staged = new Map([...committed].map(([id, document]) => [id, structuredClone(document)]));
      let writes = 0;
      const transaction = {
        collection: vi.fn(() => ({
          doc: vi.fn((id: string) => ({
            get: vi.fn().mockResolvedValue({ data: structuredClone(staged.get(id)) }),
            set: vi.fn(async (document: Record<string, unknown>) => {
              writes += 1;
              if (writes === 2) throw new Error("second write failed");
              staged.set(id, structuredClone(document));
            })
          }))
        }))
      };
      const result = await callback(transaction);
      committed.clear();
      for (const [id, document] of staged) committed.set(id, document);
      return result;
    })
  };
}

function initialFields() {
  return {
    "1001": { displayName: "requested-1001", gender: "女" as const, avatarKey: "a", updatedAt: "now" },
    "1002": { displayName: "requested-1002", gender: "男" as const, avatarKey: "b", updatedAt: "now" }
  };
}
