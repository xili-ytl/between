import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encryptBackup, type BackupData } from "../src/backup/encrypted-backup.js";
import { validBackupData, validWenliMessageEntry, completedWenliBackup } from "./backup-fixtures.js";

interface RestoreModule {
  main(dependencies: {
    environment: Record<string, string | undefined>;
    readFile: (path: string) => Promise<Uint8Array>;
    invokeAdmin: <T>(action: string, payload: Record<string, unknown>) => Promise<T>;
    output: (text: string) => void;
  }): Promise<void>;
}

describe("restore script", () => {
  it("rejects an authenticated v4 snapshot with a missing completed reply before any remote writes", async () => {
    const data = completedWenliBackup();
    data.messages = data.messages.filter((entry) => entry.data.senderId !== "wenli");
    const passphrase = "inconsistent snapshot passphrase";
    const invokeAdmin = vi.fn();
    const { main } = await import("../scripts/restore.js");
    await expect(main({ environment: { ALLOW_RESTORE: "YES", BACKUP_FILE: "fixture", BACKUP_PASSPHRASE: passphrase },
      readFile: async () => encryptedV2Fixture(data, passphrase, 4), invokeAdmin, output: vi.fn()
    })).rejects.toMatchObject({ code: "BACKUP_FORMAT_INVALID" });
    expect(invokeAdmin).not.toHaveBeenCalled();
  });
  it("is safe to import without starting a restore", async () => {
    const module = await import("../scripts/restore.js") as unknown as RestoreModule;
    expect(module.main).toBeTypeOf("function");
  });

  it("passes a validated Wenli reply to append-only message restore", async () => {
    const data = validBackupData();
    const wenliReply = validWenliMessageEntry(data.messages[0]!.id);
    data.messages.push(wenliReply);
    const passphrase = "restore Wenli passphrase";
    const invokeAdmin = vi.fn();
    invokeAdmin.mockImplementation(async (_action, payload) => {
      const entries = payload.entries as unknown[];
      return { attempted: entries.length, inserted: entries.length };
    });
    const environment: Record<string, string | undefined> = {
      ALLOW_RESTORE: "YES",
      BACKUP_FILE: "wenli.chatbackup",
      BACKUP_PASSPHRASE: passphrase
    };
    const module = await import("../scripts/restore.js") as unknown as RestoreModule;

    await module.main({
      environment,
      readFile: vi.fn().mockResolvedValue(await encryptBackup(data, passphrase)),
      invokeAdmin,
      output: vi.fn()
    });

    const messageCall = invokeAdmin.mock.calls.find(([, payload]) => payload.collection === "messages");
    expect(messageCall?.[1]).toEqual({ collection: "messages", entries: data.messages });
    expect(environment.BACKUP_PASSPHRASE).toBeUndefined();
  });

  it("does not restore an old running lease as an active lease", async () => {
    const data = validBackupData();
    data.messages.push({ id: "1001_running", data: { ...data.messages[0]!.data,
      id: "1001_running", clientMessageId: "running", body: "@问理 你好" } });
    data.wenliAgentJobs.push({
      id: "1001_running",
      data: {
        id: "1001_running",
        type: "mention",
        requesterId: "1001",
        sourceMessageId: "1001_running",
        status: "running",
        attemptCount: 1,
        leaseUntil: "2026-08-07T00:01:00.000Z",
        leaseToken: "old-lease-token",
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z"
      }
    });
    const passphrase = "restore running lease passphrase";
    const invokeAdmin = vi.fn();
    invokeAdmin.mockImplementation(async (_action, payload) => {
      const entries = payload.entries as unknown[];
      return { attempted: entries.length, inserted: entries.length };
    });
    const environment: Record<string, string | undefined> = {
      ALLOW_RESTORE: "YES",
      BACKUP_FILE: "running.chatbackup",
      BACKUP_PASSPHRASE: passphrase
    };
    const module = await import("../scripts/restore.js") as unknown as RestoreModule;

    await module.main({
      environment,
      readFile: vi.fn().mockResolvedValue(await encryptBackup(data, passphrase)),
      invokeAdmin,
      output: vi.fn()
    });

    const jobCall = invokeAdmin.mock.calls.find(([, payload]) => payload.collection === "wenliAgentJobs");
    expect(jobCall?.[1]).toEqual({
      collection: "wenliAgentJobs",
      entries: [{
        id: "1001_running",
        data: {
          id: "1001_running",
          type: "mention",
          requesterId: "1001",
          sourceMessageId: "1001_running",
          status: "pending",
          attemptCount: 1,
          nextAttemptAt: expect.any(String),
          createdAt: "2026-08-07T00:00:00.000Z",
          updatedAt: expect.any(String)
        }
      }]
    });
    expect(environment.BACKUP_PASSPHRASE).toBeUndefined();
  });

  it.each([
    ["messages", (data: BackupData) => { data.messages[0]!.data.senderId = "1002"; }],
    ["momentComments", (data: BackupData) => { data.momentComments[0]!.data.authorId = "1001"; }]
  ])("rejects an invalid final %s record before any remote write", async (_collection, mutate) => {
    const data = validBackupData();
    mutate(data);
    const passphrase = "restore test passphrase";
    const encrypted = encryptedV2Fixture(data, passphrase);
    const invokeAdmin = vi.fn();
    const environment: Record<string, string | undefined> = {
      ALLOW_RESTORE: "YES",
      BACKUP_FILE: "invalid.chatbackup",
      BACKUP_PASSPHRASE: passphrase
    };
    const module = await import("../scripts/restore.js") as unknown as RestoreModule;

    await expect(module.main({
      environment,
      readFile: vi.fn().mockResolvedValue(encrypted),
      invokeAdmin,
      output: vi.fn()
    })).rejects.toMatchObject({ code: "BACKUP_FORMAT_INVALID" });
    expect(invokeAdmin).not.toHaveBeenCalled();
    expect(environment.BACKUP_PASSPHRASE).toBeUndefined();
  });
});

function encryptedV2Fixture(data: BackupData, passphrase: string, version = 2): Buffer {
  const document = {
    version,
    exportedAt: "2026-08-07T00:00:00.000Z",
    data,
    checksum: createHash("sha256").update(JSON.stringify(data)).digest("hex")
  };
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(document), "utf8"), cipher.final()]);
  return Buffer.from(JSON.stringify({
    format: "couple-chat-backup",
    version: 1,
    kdf: "scrypt",
    cipher: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  }), "utf8");
}
