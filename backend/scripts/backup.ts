import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { encryptBackup, type BackupData, type BackupEntry } from "../src/backup/encrypted-backup.js";
import { AppError } from "../src/domain/errors.js";
import { invokeAdmin as invokeAdminRequest } from "./admin-client.js";

interface ExportPage {
  entries: BackupEntry[];
  nextCursor: string | null;
}

export interface BackupDependencies {
  environment: Record<string, string | undefined>;
  invokeAdmin: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  mkdir: (path: string) => Promise<unknown>;
  writeFile: (path: string, data: Uint8Array) => Promise<unknown>;
  currentDirectory: () => string;
  clock: () => Date;
  output: (text: string) => void;
}

const DEFAULT_DEPENDENCIES: BackupDependencies = {
  environment: process.env,
  invokeAdmin: invokeAdminRequest,
  mkdir: (path) => mkdir(path, { recursive: true }),
  writeFile: (path, data) => writeFile(path, data, { flag: "wx", mode: 0o600 }),
  currentDirectory: () => process.cwd(),
  clock: () => new Date(),
  output: (text) => process.stdout.write(text)
};

export async function main(dependencies: BackupDependencies = DEFAULT_DEPENDENCIES): Promise<void> {
  try {
    const data: BackupData = {
      users: await exportCollection(dependencies, "users"),
      relationships: await exportCollection(dependencies, "relationships"),
      moments: await exportCollection(dependencies, "moments"),
      momentLikes: await exportCollection(dependencies, "momentLikes"),
      momentComments: await exportCollection(dependencies, "momentComments"),
      readStates: await exportCollection(dependencies, "readStates"),
      messages: await exportCollection(dependencies, "messages"),
      wenliAgentJobs: await exportCollection(dependencies, "wenliAgentJobs"),
      wenliMemories: await exportCollection(dependencies, "wenliMemories")
    };
    const passphrase = requiredEnvironment(dependencies.environment, "BACKUP_PASSPHRASE");
    const encrypted = await encryptBackup(data, passphrase);
    const directory = resolve(dependencies.currentDirectory(), "..", "backups");
    await dependencies.mkdir(directory);
    const timestamp = dependencies.clock().toISOString().replace(/[:.]/g, "-");
    const file = resolve(directory, `${timestamp}.chatbackup`);
    await dependencies.writeFile(file, encrypted);
    dependencies.output(
      `加密备份已生成：${file}\n账号 ${data.users.length}，关系 ${data.relationships.length}，` +
      `动态 ${data.moments.length}，点赞 ${data.momentLikes.length}，评论 ${data.momentComments.length}，` +
      `消息 ${data.messages.length}，小Q任务 ${data.wenliAgentJobs.length}，` +
      `小Q记忆 ${data.wenliMemories.length}。\n`
    );
  } finally {
    delete dependencies.environment.BACKUP_PASSPHRASE;
  }
}

async function exportCollection(
  dependencies: BackupDependencies,
  collection: keyof BackupData
): Promise<BackupEntry[]> {
  const entries: BackupEntry[] = [];
  let afterId: string | null = null;
  while (true) {
    const page = await dependencies.invokeAdmin(
      "admin.exportPage",
      { collection, afterId, limit: 500 }
    ) as ExportPage;
    entries.push(...page.entries);
    if (page.entries.length < 500 || page.nextCursor === null) return entries;
    afterId = page.nextCursor;
  }
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
    process.stderr.write("Backup failed.\n");
    process.exitCode = 1;
  });
}
