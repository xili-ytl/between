import { isIP } from "node:net";
import type { ApiRequest, ApiResponse } from "./api/api-router.js";

interface RouterLike {
  handle(request: ApiRequest, source: string): Promise<ApiResponse>;
}

type UnknownRecord = Record<string, unknown>;
const SOURCE_KEYS = ["TCB_SOURCE_IP", "WX_CLIENTIP", "WX_CLIENTIPV6"];

export function createFunctionHandler(router: RouterLike) {
  return async (event: unknown, context: unknown): Promise<ApiResponse> => {
    const request = asRecord(event) as ApiRequest;
    return router.handle(request, requestSource(event, context));
  };
}

export function requestSource(_event: unknown, context: unknown): string {
  // Business events are caller-controlled; use only this invocation's platform context.
  const environment = invocationEnvironment(context);
  for (const key of SOURCE_KEYS) {
    const value = environment[key];
    if (typeof value !== "string") continue;
    const address = value.trim();
    if (isIP(address)) return address;
  }
  return "unknown";
}

function invocationEnvironment(context: unknown): UnknownRecord {
  const record = asRecord(context);
  if (typeof record.environment === "string" && record.environment !== "") {
    try {
      return asRecord(JSON.parse(record.environment));
    } catch {
      return {};
    }
  }
  if (record.environment !== undefined && record.environment !== null && record.environment !== "") {
    return asRecord(record.environment);
  }

  // Older SCF runtimes supply semicolon-separated key=value entries in environ.
  const environment: UnknownRecord = {};
  if (typeof record.environ !== "string") return environment;
  for (const entry of record.environ.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 1) continue;
    const key = entry.slice(0, separator);
    if (SOURCE_KEYS.includes(key)) environment[key] = entry.slice(separator + 1);
  }
  return environment;
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}
