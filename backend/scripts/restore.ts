import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decryptBackup, type BackupData, type BackupEntry } from "../src/backup/encrypted-backup.js";
import { AppError } from "../src/domain/errors.js";
import { invokeAdmin as invokeAdminRequest } from "./admin-client.js";

export interface RestoreDependencies {
  environment: Record<string, string | undefined>;
  readFile: (path: string) => Promise<Uint8Array>;
  invokeAdmin: <T>(action: string, payload: Record<string, unknown>) => Promise<T>;
  output: (text: string) => void;
  clock?: () => Date;
}

const DEFAULT_DEPENDENCIES: RestoreDependencies = {
  environment: process.env,
  readFile,
  invokeAdmin: invokeAdminRequest,
  output: (text) => process.stdout.write(text)
};

export async function main(dependencies: RestoreDependencies = DEFAULT_DEPENDENCIES): Promise<void> {
  try {
    if (dependencies.environment.ALLOW_RESTORE !== "YES") {
      throw new AppError("RESTORE_NOT_CONFIRMED", "恢复前必须设置 ALLOW_RESTORE=YES");
    }
    const file = requiredEnvironment(dependencies.environment, "BACKUP_FILE");
    const passphrase = requiredEnvironment(dependencies.environment, "BACKUP_PASSPHRASE");
    const document = await decryptBackup(await dependencies.readFile(file), passphrase);
    const data = document.data;
    dependencies.output(
      `备份校验通过：账号 ${data.users.length}，关系 ${data.relationships.length}，` +
      `动态 ${data.moments.length}，点赞 ${data.momentLikes.length}，` +
      `评论 ${data.momentComments.length}，消息 ${data.messages.length}，` +
      `小Q任务 ${data.wenliAgentJobs.length}，小Q记忆 ${data.wenliMemories.length}。\n`
    );

    let inserted = 0;
    const clock = dependencies.clock ?? (() => new Date());
    inserted += await restoreCollection(dependencies, "users", data.users, clock);
    inserted += await restoreCollection(dependencies, "relationships", data.relationships, clock);
    inserted += await restoreCollection(dependencies, "moments", data.moments, clock);
    inserted += await restoreCollection(dependencies, "momentLikes", data.momentLikes, clock);
    inserted += await restoreCollection(dependencies, "momentComments", data.momentComments, clock);
    inserted += await restoreCollection(dependencies, "readStates", data.readStates, clock);
    inserted += await restoreCollection(dependencies, "messages", data.messages, clock);
    inserted += await restoreCollection(dependencies, "wenliAgentJobs", data.wenliAgentJobs, clock);
    inserted += await restoreCollection(dependencies, "wenliMemories", data.wenliMemories, clock);
    dependencies.output(`恢复完成：仅补入 ${inserted} 条缺失记录，已有记录未被覆盖。\n`);
  } finally {
    delete dependencies.environment.BACKUP_PASSPHRASE;
  }
}

async function restoreCollection(
  dependencies: RestoreDependencies,
  collection: keyof BackupData,
  entries: BackupEntry[],
  clock: () => Date
): Promise<number> {
  let collectionInserted = 0;
  for (let offset = 0; offset < entries.length; offset += 500) {
    const page = entries.slice(offset, offset + 500).map((entry) => restoreEntry(collection, entry, clock));
    const result = await dependencies.invokeAdmin<{ attempted: number; inserted: number }>(
      "admin.importMissingPage",
      { collection, entries: page }
    );
    collectionInserted += result.inserted;
  }
  return collectionInserted;
}

function restoreEntry(collection: keyof BackupData, entry: BackupEntry, clock: () => Date): BackupEntry {
  if (collection !== "wenliAgentJobs" || entry.data.status !== "running") return entry;
  const now = clock().toISOString();
  const { leaseUntil: _leaseUntil, leaseToken: _leaseToken, ...withoutLease } = entry.data;
  void _leaseUntil;
  void _leaseToken;
  return {
    id: entry.id,
    data: {
      ...withoutLease,
      status: "pending",
      nextAttemptAt: now,
      updatedAt: now
    }
  };
}

function requiredEnvironment(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name];
  if (!value) throw new AppError("ENVIRONMENT_MISSING", `缺少环境变量 ${name}`);
  return value;
}

function isDirectRun(): boolean {
  const script = process.argv[1];
  return script !== undefined && pathToFileURL(resolve(script)).href === import.meta.url;
}

if (isDirectRun()) {
  void main().catch(() => {
    process.stderr.write("Restore failed.\n");
    process.exitCode = 1;
  });
}
