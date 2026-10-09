import type { ApiRequest, ApiResponse } from "./api/api-router.js";

interface RouterLike {
  handle(request: ApiRequest, source: string): Promise<ApiResponse>;
}

type UnknownRecord = Record<string, unknown>;

export function createFunctionHandler(router: RouterLike) {
  return async (event: unknown, context: unknown): Promise<ApiResponse> => {
    const request = asRecord(event) as ApiRequest;
    return router.handle(request, requestSource(event, context));
  };
}

export function requestSource(event: unknown, context: unknown): string {
  const headers = asRecord(asRecord(event).headers);
  const forwarded = header(headers, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 128) || "unknown";

  const environment = asRecord(asRecord(context).environment);
  const cloudBaseAddress = environment.WX_CLIENTIP;
  if (typeof cloudBaseAddress === "string" && cloudBaseAddress) return cloudBaseAddress.slice(0, 128);
  return "unknown";
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function header(headers: UnknownRecord, name: string): string | null {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return typeof entry?.[1] === "string" ? entry[1] : null;
}
