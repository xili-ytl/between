import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decryptBackup } from "../src/backup/encrypted-backup.js";
import { AppError } from "../src/domain/errors.js";

export interface VerifyBackupDependencies {
  environment: Record<string, string | undefined>;
  readFile: (path: string) => Promise<Uint8Array>;
  output: (text: string) => void;
}

const DEFAULT_DEPENDENCIES: VerifyBackupDependencies = {
  environment: process.env,
  readFile,
  output: (text) => process.stdout.write(text)
};

export async function main(dependencies: VerifyBackupDependencies = DEFAULT_DEPENDENCIES): Promise<void> {
  try {
    const file = requiredEnvironment(dependencies.environment, "BACKUP_FILE");
    const passphrase = requiredEnvironment(dependencies.environment, "BACKUP_PASSPHRASE");
    const document = await decryptBackup(await dependencies.readFile(file), passphrase);
    const data = document.data;
    dependencies.output(
      `备份版本 ${document.version}：账号 ${data.users.length}，关系 ${data.relationships.length}，` +
      `动态 ${data.moments.length}，点赞 ${data.momentLikes.length}，评论 ${data.momentComments.length}，` +
      `消息 ${data.messages.length}，问理任务 ${data.wenliAgentJobs.length}，` +
      `问理记忆 ${data.wenliMemories.length}。\n`
    );
  } finally {
    delete dependencies.environment.BACKUP_PASSPHRASE;
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
    process.stderr.write("Backup verification failed.\n");
    process.exitCode = 1;
  });
}
