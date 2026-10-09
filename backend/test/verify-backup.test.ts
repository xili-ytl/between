import { describe, expect, it, vi } from "vitest";
import { encryptBackup } from "../src/backup/encrypted-backup.js";
import { main } from "../scripts/verify-backup.js";
import { validBackupData } from "./backup-fixtures.js";

describe("backup verification script", () => {
  it("decrypts and reports all collection counts without writes or network access", async () => {
    const data = validBackupData();
    const encrypted = await encryptBackup(data, "verification passphrase", () => new Date("2026-08-07T00:00:00.000Z"));
    const environment: Record<string, string | undefined> = {
      BACKUP_FILE: "fixture.chatbackup",
      BACKUP_PASSPHRASE: "verification passphrase"
    };
    const output = vi.fn();
    const readFile = vi.fn().mockResolvedValue(encrypted);

    await main({ environment, readFile, output });

    expect(readFile).toHaveBeenCalledWith("fixture.chatbackup");
    expect(output).toHaveBeenCalledWith(
      "备份版本 4：账号 1，关系 1，动态 1，点赞 1，评论 1，消息 1，问理任务 0，问理记忆 0。\n"
    );
    expect(environment.BACKUP_PASSPHRASE).toBeUndefined();
  });

  it("clears the passphrase even when another required setting is missing", async () => {
    const environment: Record<string, string | undefined> = {
      BACKUP_PASSPHRASE: "verification passphrase"
    };

    await expect(main({ environment, readFile: vi.fn(), output: vi.fn() }))
      .rejects.toMatchObject({ code: "ENVIRONMENT_MISSING" });
    expect(environment.BACKUP_PASSPHRASE).toBeUndefined();
  });
});
