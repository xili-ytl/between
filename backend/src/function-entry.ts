import * as cloudbase from "@cloudbase/node-sdk";
import { NodeCloudBasePersistence } from "./adapters/cloudbase-persistence.js";
import { createApiRouter } from "./app-factory.js";
import { createFunctionHandler } from "./function-handler.js";

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const router = createApiRouter(new NodeCloudBasePersistence(app), app);
const handler = createFunctionHandler(router);

export const main = async (event: unknown, context: unknown) => {
  return handler(event, context);
};
