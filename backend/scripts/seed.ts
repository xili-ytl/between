import { invokeAdmin, requiredEnvironment } from "./admin-client.js";

interface SeedResult {
  createdAccounts: string[];
  relationshipCreated: boolean;
}

try {
  const initialPassword = requiredEnvironment("INITIAL_CHAT_PASSWORD");
  const result = await invokeAdmin<SeedResult>("admin.seed", { initialPassword });
  process.stdout.write(
    `初始化完成：新增账号 ${result.createdAccounts.length} 个，新增固定关系 ${result.relationshipCreated ? 1 : 0} 个。\n`,
  );
} finally {
  delete process.env.INITIAL_CHAT_PASSWORD;
}
