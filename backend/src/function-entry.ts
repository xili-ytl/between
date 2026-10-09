import * as cloudbase from "@cloudbase/node-sdk";
import { NodeCloudBasePersistence } from "./adapters/cloudbase-persistence.js";
import { createApiRouter } from "./app-factory.js";
import { createFunctionHandler } from "./function-handler.js";

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const router = createApiRouter(new NodeCloudBasePersistence(app), app);
const handler = createFunctionHandler(router);

// CloudBase 文档集合需先创建才能写入；幂等确保相关集合存在。
async function ensureCollections() {
  for (const name of ["petSessions", "pet", "wenliAgentJobs", "wenliMemories"]) {
    await db().createCollection(name).catch(() => {});
  }
}

export const main = async (event: unknown, context: unknown) => {
  await ensureCollections();
  return handler(event, context);
};

function db() {
  return app.database();
}
