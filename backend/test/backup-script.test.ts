import { describe, expect, it, vi } from "vitest";
import type { BackupData } from "../src/backup/encrypted-backup.js";
import { validBackupData, completedWenliBackup } from "./backup-fixtures.js";

interface BackupModule {
  main(dependencies: {
    environment: Record<string, string | undefined>;
    invokeAdmin: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
    mkdir: (path: string) => Promise<unknown>;
    writeFile: (path: string, data: Uint8Array) => Promise<unknown>;
    currentDirectory: () => string;
    clock: () => Date;
    output: (text: string) => void;
  }): Promise<void>;
}

describe("backup script", () => {
  it("does not write a successful backup when a later exported job has no exported reply", async () => {
    const data = completedWenliBackup();
    data.messages = data.messages.filter((entry) => entry.data.senderId !== "wenli");
    const writeFile = vi.fn();
    const output = vi.fn();
    const { main } = await import("../scripts/backup.js");
    await expect(main({
      environment: { BACKUP_PASSPHRASE: "snapshot passphrase" },
      invokeAdmin: async (_action, payload) => ({ entries: data[payload.collection as keyof BackupData], nextCursor: null }),
      mkdir: vi.fn(), writeFile, currentDirectory: () => "C:/test/backend",
      clock: () => new Date("2026-08-07T00:00:00.000Z"), output
    })).rejects.toMatchObject({ code: "BACKUP_FORMAT_INVALID" });
    expect(writeFile).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });
  it("is safe to import without starting a backup", async () => {
    const module = await import("../scripts/backup.js") as unknown as BackupModule;
    expect(module.main).toBeTypeOf("function");
  });

  it("exports all nine collections and clears the passphrase after success", async () => {
    const data = validBackupData();
    const invokeAdmin = vi.fn(async (_action: string, payload: Record<string, unknown>) => ({
      entries: data[payload.collection as keyof BackupData],
      nextCursor: null
    }));
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const environment: Record<string, string | undefined> = { BACKUP_PASSPHRASE: "backup secret" };
    const module = await import("../scripts/backup.js") as unknown as BackupModule;

    await module.main({
      environment,
      invokeAdmin,
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile,
      currentDirectory: () => "C:/workspace/backend",
      clock: () => new Date("2026-08-07T00:00:00.000Z"),
      output: vi.fn()
    });

    expect(invokeAdmin.mock.calls.map((call) => call[1].collection)).toEqual([
      "users", "relationships", "moments", "momentLikes", "momentComments", "readStates", "messages"
      , "wenliAgentJobs", "wenliMemories"
    ]);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(environment.BACKUP_PASSPHRASE).toBeUndefined();
  });

  it("clears the passphrase when export fails", async () => {
    const environment: Record<string, string | undefined> = { BACKUP_PASSPHRASE: "backup secret" };
    const module = await import("../scripts/backup.js") as unknown as BackupModule;

    await expect(module.main({
      environment,
      invokeAdmin: vi.fn().mockRejectedValue(new Error("export failed")),
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      currentDirectory: () => "C:/workspace/backend",
      clock: () => new Date("2026-08-07T00:00:00.000Z"),
      output: vi.fn()
    })).rejects.toThrow("export failed");
    expect(environment.BACKUP_PASSPHRASE).toBeUndefined();
  });
});
