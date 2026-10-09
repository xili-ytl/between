import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback
} from "node:crypto";
import { promisify } from "node:util";
import { AppError } from "../domain/errors.js";
import {
  canonicalizeBackupData,
  canonicalizeLegacyBackupData,
  canonicalizeLegacyV2BackupData,
  canonicalizeLegacyV3BackupData
} from "./backup-validator.js";
import type { BackupData } from "./backup-validator.js";

export type { BackupData, BackupEntry } from "./backup-validator.js";

const scrypt = promisify(scryptCallback);

export interface BackupDocument {
  version: 4;
  exportedAt: string;
  data: BackupData;
  checksum: string;
}

interface EncryptedEnvelope {
  format: "couple-chat-backup";
  version: 1;
  kdf: "scrypt";
  cipher: "aes-256-gcm";
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export async function encryptBackup(
  data: BackupData,
  passphrase: string,
  clock: () => Date = () => new Date()
): Promise<Buffer> {
  assertPassphrase(passphrase);
  const normalizedData = canonicalizeBackupData(data);
  const document: BackupDocument = {
    version: 4,
    exportedAt: clock().toISOString(),
    data: normalizedData,
    checksum: checksum(normalizedData)
  };
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(document), "utf8"), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    format: "couple-chat-backup",
    version: 1,
    kdf: "scrypt",
    cipher: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

export async function decryptBackup(encrypted: Uint8Array, passphrase: string): Promise<BackupDocument> {
  assertPassphrase(passphrase);
  let plaintext: Buffer;
  try {
    const envelope = envelopeValue(JSON.parse(Buffer.from(encrypted).toString("utf8")));
    const salt = base64Value(envelope.salt, 16);
    const iv = base64Value(envelope.iv, 12);
    const authTag = base64Value(envelope.authTag, 16);
    const ciphertext = base64Value(envelope.ciphertext);
    const key = await deriveKey(passphrase, salt);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new AppError("BACKUP_DECRYPT_FAILED", "备份密码错误或文件已损坏");
  }

  let document: unknown;
  try {
    document = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new AppError("BACKUP_DECRYPT_FAILED", "备份密码错误或文件已损坏");
  }
  return normalizedBackupDocument(document);
}

export function assertBackupDocument(value: unknown): asserts value is BackupDocument {
  v4DocumentValue(value);
}

function normalizedBackupDocument(value: unknown): BackupDocument {
  const document = documentRecord(value);
  if (document.version === 4) return v4DocumentValue(document);
  if (document.version === 3) {
    const exportedAt = timestampValue(document.exportedAt);
    const storedChecksum = checksumValue(document.checksum);
    if (checksumRaw(document.data) !== storedChecksum) invalidChecksum();
    const data = canonicalizeLegacyV3BackupData(document.data);
    return { version: 4, exportedAt, data, checksum: checksum(data) };
  }
  if (document.version === 2) {
    const exportedAt = timestampValue(document.exportedAt);
    const storedChecksum = checksumValue(document.checksum);
    if (checksumRaw(document.data) !== storedChecksum) invalidChecksum();
    const data = canonicalizeLegacyV2BackupData(document.data);
    return { version: 4, exportedAt, data, checksum: checksum(data) };
  }
  if (document.version !== 1) invalidFormat();

  const exportedAt = timestampValue(document.exportedAt);
  const storedChecksum = checksumValue(document.checksum);
  if (checksumRaw(document.data) !== storedChecksum) invalidChecksum();
  const data = canonicalizeLegacyBackupData(document.data);
  const normalizedData: BackupData = {
    users: data.users,
    relationships: data.relationships,
    messages: data.messages,
    moments: [],
    momentLikes: [],
    momentComments: [],
    readStates: [],
    wenliAgentJobs: [],
    wenliMemories: []
  };
  return {
    version: 4,
    exportedAt,
    data: normalizedData,
    checksum: checksum(normalizedData)
  };
}

function v4DocumentValue(value: unknown): BackupDocument {
  const document = documentRecord(value);
  if (document.version !== 4) invalidFormat();
  const exportedAt = timestampValue(document.exportedAt);
  const storedChecksum = checksumValue(document.checksum);
  if (checksumRaw(document.data) !== storedChecksum) invalidChecksum();
  const data = canonicalizeBackupData(document.data);
  return { version: 4, exportedAt, data, checksum: checksum(data) };
}

function documentRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "exportedAt", "data", "checksum"])) invalidFormat();
  return value;
}

function envelopeValue(value: unknown): EncryptedEnvelope {
  if (!isRecord(value) ||
    value.format !== "couple-chat-backup" || value.version !== 1 ||
    value.kdf !== "scrypt" || value.cipher !== "aes-256-gcm" ||
    typeof value.salt !== "string" || typeof value.iv !== "string" ||
    typeof value.authTag !== "string" || typeof value.ciphertext !== "string") {
    throw new Error("invalid envelope");
  }
  return value as unknown as EncryptedEnvelope;
}

function base64Value(value: string, expectedBytes?: number): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("invalid base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) throw new Error("invalid length");
  return bytes;
}

function timestampValue(value: unknown): string {
  if (typeof value !== "string") invalidFormat();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) invalidFormat();
  return value;
}

function checksumValue(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalidFormat();
  return value;
}

function checksum(data: BackupData): string {
  return checksumRaw(data);
}

function checksumRaw(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<Buffer> {
  return await scrypt(passphrase, salt, 32) as Buffer;
}

function assertPassphrase(passphrase: string): void {
  if ([...passphrase].length < 12) {
    throw new AppError("BACKUP_PASSPHRASE_INVALID", "备份密码至少需要 12 个字符");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function invalidFormat(): never {
  throw new AppError("BACKUP_FORMAT_INVALID", "备份格式无效");
}

function invalidChecksum(): never {
  throw new AppError("BACKUP_CHECKSUM_INVALID", "备份校验失败");
}
