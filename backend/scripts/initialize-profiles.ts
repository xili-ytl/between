import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AccountId } from "../src/domain/contracts.js";
import { invokeAdmin } from "./admin-client.js";

interface InitializeProfilesResult {
  initializedAccounts: AccountId[];
}

const avatar1001 = await readFile(fileURLToPath(new URL("../assets/initial-avatars/1001.jpg", import.meta.url)));
const avatar1002 = await readFile(fileURLToPath(new URL("../assets/initial-avatars/1002.jpg", import.meta.url)));

const result = await invokeAdmin<InitializeProfilesResult>("admin.initializeProfiles", {
  avatars: [
    { accountId: "1001", contentType: "image/jpeg", base64: avatar1001.toString("base64") },
    { accountId: "1002", contentType: "image/jpeg", base64: avatar1002.toString("base64") }
  ]
});

process.stdout.write(`初始资料迁移完成：本次初始化 ${result.initializedAccounts.length} 个账号。\n`);
