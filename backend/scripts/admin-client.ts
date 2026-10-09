import { AppError } from "../src/domain/errors.js";

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiFailure {
  ok: false;
  error: { code: string; message: string };
}

type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export async function invokeAdmin<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const functionUrl = requiredEnvironment("CLOUDBASE_FUNCTION_URL");
  const publishableKey = requiredEnvironment("CLOUDBASE_PUBLISHABLE_KEY");
  const adminToken = requiredEnvironment("BACKUP_ADMIN_TOKEN");
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${publishableKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, payload: { ...payload, adminToken } }),
  });

  if (!response.ok) {
    throw new AppError("CLOUD_REQUEST_FAILED", `CloudBase 请求失败（${response.status}）`);
  }

  const envelope = unwrapCloudBase<T>(await response.json());
  if (!envelope.ok) throw new AppError(envelope.error.code, envelope.error.message);
  return envelope.data;
}

export function unwrapCloudBase<T>(value: unknown): ApiEnvelope<T> {
  const outer = asRecord(value);
  const result = outer && "result" in outer ? outer.result : value;
  const inner = typeof result === "string" ? parseJson(result) : result;
  const envelope = asRecord(inner);

  if (envelope?.ok === true) {
    if (!Object.prototype.hasOwnProperty.call(envelope, "data")) throw invalidResponse();
    return { ok: true, data: envelope.data as T };
  }

  if (envelope?.ok === false) {
    const error = asRecord(envelope.error);
    if (!error || typeof error.code !== "string" || typeof error.message !== "string") {
      throw invalidResponse();
    }
    return { ok: false, error: { code: error.code, message: error.message } };
  }

  throw invalidResponse();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw invalidResponse();
  }
}

function invalidResponse(): AppError {
  return new AppError("CLOUD_RESPONSE_INVALID", "CloudBase 返回了无法识别的数据");
}

export function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new AppError("ENVIRONMENT_MISSING", `缺少环境变量 ${name}`);
  return value;
}
