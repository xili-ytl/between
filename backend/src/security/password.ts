import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, salt64, key64] = encoded.split("$");
  if (scheme !== "scrypt" || !salt64 || !key64) return false;

  try {
    const expected = Buffer.from(key64, "base64");
    if (expected.length === 0) return false;
    const actual = (await scrypt(password, Buffer.from(salt64, "base64"), expected.length)) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
