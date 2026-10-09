import { readFileSync } from "node:fs";
import { sign } from "node:crypto";

const [version, versionCode, artifactKey, size, sha256] = process.argv.slice(2);
if (
  !/^\d+\.\d+\.\d+$/.test(version ?? "") ||
  !/^\d+$/.test(versionCode ?? "") ||
  !/^releases\/pet\/[A-Za-z0-9._-]+\.exe$/.test(artifactKey ?? "") ||
  !/^\d+$/.test(size ?? "") ||
  !/^[a-f0-9]{64}$/.test(sha256 ?? "")
) {
  throw new Error(
    "usage: sign-pet-release <version> <versionCode> <artifactKey> <size> <sha256>",
  );
}

const privatePath = process.env.QPET_UPDATE_PRIVATE_KEY_PATH;
if (!privatePath) {
  throw new Error("QPET_UPDATE_PRIVATE_KEY_PATH is required");
}
const canonical = [version, versionCode, artifactKey, size, sha256].join("\n");
const signature = sign(
  null,
  Buffer.from(canonical, "utf8"),
  readFileSync(privatePath),
).toString("base64");
process.stdout.write(`${signature}\n`);
