import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AppError } from "../src/domain/errors.js";
import { unwrapCloudBase } from "./admin-client.js";

interface SmokeConfiguration {
  functionUrl: string;
  publishableKey: string;
  adminToken: string;
  password1001: string;
  password1002: string;
}

export interface SmokeDependencies {
  environment: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
  output: (text: string) => void;
  uniqueSuffix: () => string;
}

interface MomentView {
  id: string;
  likes: Array<{ accountId: string }>;
  comments: Array<{ id: string; authorId: string }>;
}

interface ExportPage {
  entries: Array<{ id: string; data: Record<string, unknown> }>;
  nextCursor: string | null;
}

const DEFAULT_DEPENDENCIES: SmokeDependencies = {
  environment: process.env,
  fetch: (...arguments_) => globalThis.fetch(...arguments_),
  output: (text) => process.stdout.write(text),
  uniqueSuffix: () => randomUUID().replaceAll("-", "")
};

export async function main(dependencies: SmokeDependencies = DEFAULT_DEPENDENCIES): Promise<void> {
  const configuration = configurationValue(dependencies.environment);
  const prefix = `smoke_${dependencies.uniqueSuffix()}`;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(prefix)) {
    throw new AppError("SMOKE_ID_INVALID", "Smoke identifier generation failed");
  }

  const privateClientId = `${prefix}_self`;
  const hiddenCommentClientId = `${prefix}_hidden_comment`;
  const partnerClientId = `${prefix}_partner`;
  const commentClientId = `${prefix}_comment`;
  const privateMomentId = `1001_${privateClientId}`;
  const partnerMomentId = `1001_${partnerClientId}`;
  const commentId = `1002_${commentClientId}`;
  let session1001: string | null = null;
  let session1002: string | null = null;
  let primaryFailed = false;
  let primaryFailure: unknown;

  try {
    session1001 = sessionToken(await invoke<Record<string, unknown>>(
      configuration,
      dependencies,
      "auth.login",
      { accountId: "1001", password: configuration.password1001 }
    ));
    session1002 = sessionToken(await invoke<Record<string, unknown>>(
      configuration,
      dependencies,
      "auth.login",
      { accountId: "1002", password: configuration.password1002 }
    ));

    const privatePost = recordValue(await invoke(
      configuration,
      dependencies,
      "moments.create",
      { clientMomentId: privateClientId, body: "smoke private", visibility: "SELF" },
      session1001
    ));
    assert(privatePost.id === privateMomentId, "private Moment id mismatch");
    assert(!feedContains(await feed(configuration, dependencies, session1002), privateMomentId),
      "SELF Moment was visible to partner");
    await expectApiError(
      () => invoke(configuration, dependencies, "moments.like", { momentId: privateMomentId }, session1002!),
      "MOMENT_NOT_FOUND"
    );
    await expectApiError(
      () => invoke(configuration, dependencies, "moments.comments.create", {
        momentId: privateMomentId,
        clientCommentId: hiddenCommentClientId,
        body: "hidden smoke comment"
      }, session1002!),
      "MOMENT_NOT_FOUND"
    );
    await invoke(configuration, dependencies, "moments.delete", { momentId: privateMomentId }, session1001);

    const partnerPost = recordValue(await invoke(
      configuration,
      dependencies,
      "moments.create",
      { clientMomentId: partnerClientId, body: "smoke partner", visibility: "PARTNER" },
      session1001
    ));
    assert(partnerPost.id === partnerMomentId, "partner Moment id mismatch");
    assert(feedContains(await feed(configuration, dependencies, session1002), partnerMomentId),
      "PARTNER Moment was not visible");
    await expectApiError(
      () => invoke(configuration, dependencies, "moments.delete", { momentId: partnerMomentId }, session1002!),
      "MOMENT_FORBIDDEN"
    );

    await invoke(configuration, dependencies, "moments.like", { momentId: partnerMomentId }, session1002);
    const comment = recordValue(await invoke(
      configuration,
      dependencies,
      "moments.comments.create",
      { momentId: partnerMomentId, clientCommentId: commentClientId, body: "smoke comment" },
      session1002
    ));
    assert(comment.id === commentId, "comment id mismatch");

    const aggregate = (await feed(configuration, dependencies, session1002))
      .find((moment) => moment.id === partnerMomentId);
    assert(aggregate !== undefined, "partner Moment disappeared");
    assert(aggregate.likes.some((like) => like.accountId === "1002"), "like aggregate is missing");
    assert(aggregate.comments.some((entry) => entry.id === commentId && entry.authorId === "1002"),
      "comment aggregate is missing");

    await invoke(configuration, dependencies, "moments.comments.delete", { commentId }, session1002);
    await invoke(configuration, dependencies, "moments.delete", { momentId: partnerMomentId }, session1001);

    for (const session of [session1001, session1002]) {
      const latest = await feed(configuration, dependencies, session);
      assert(!feedContains(latest, privateMomentId) && !feedContains(latest, partnerMomentId),
        "deleted Moments remained in a feed");
    }

    for (const collection of ["moments", "momentLikes", "momentComments"] as const) {
      const entries = await exportAll(configuration, dependencies, collection);
      assert(!entries.some((entry) => JSON.stringify(entry).includes(prefix)),
        `smoke references remained in ${collection}`);
    }
  } catch (error) {
    primaryFailed = true;
    primaryFailure = error;
  } finally {
    const cleanupFailures: unknown[] = [];
    if (session1002 !== null) {
      await bestEffort(
        () => invoke(configuration, dependencies, "moments.comments.delete", { commentId }, session1002!),
        cleanupFailures
      );
    }
    if (session1001 !== null) {
      await bestEffort(
        () => invoke(configuration, dependencies, "moments.delete", { momentId: privateMomentId }, session1001!),
        cleanupFailures
      );
      await bestEffort(
        () => invoke(configuration, dependencies, "moments.delete", { momentId: partnerMomentId }, session1001!),
        cleanupFailures
      );
    }
    if (session1001 !== null) {
      await bestEffort(() => invoke(configuration, dependencies, "auth.logout", {}, session1001!), cleanupFailures);
    }
    if (session1002 !== null) {
      await bestEffort(() => invoke(configuration, dependencies, "auth.logout", {}, session1002!), cleanupFailures);
    }
    if (cleanupFailures.length > 0) {
      if (primaryFailed) {
        throw new AggregateError([primaryFailure, ...cleanupFailures], "Moments smoke and cleanup failed");
      }
      throw new AppError("SMOKE_CLEANUP_FAILED", "Moments smoke cleanup failed");
    }
  }

  if (primaryFailed) throw primaryFailure;

  dependencies.output("Moments smoke check passed and cleaned up.\n");
}

async function invoke<T = unknown>(
  configuration: SmokeConfiguration,
  dependencies: SmokeDependencies,
  action: string,
  payload: Record<string, unknown>,
  sessionToken?: string
): Promise<T> {
  const request: Record<string, unknown> = { action, payload };
  if (sessionToken !== undefined) request.sessionToken = sessionToken;
  const response = await dependencies.fetch(configuration.functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${configuration.publishableKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    throw new AppError("CLOUD_REQUEST_FAILED", `CloudBase request failed (${response.status})`);
  }
  const envelope = unwrapCloudBase<T>(await response.json());
  if (!envelope.ok) throw new AppError(envelope.error.code, envelope.error.message);
  return envelope.data;
}

async function feed(
  configuration: SmokeConfiguration,
  dependencies: SmokeDependencies,
  sessionToken: string
): Promise<MomentView[]> {
  const value = await invoke<unknown>(configuration, dependencies, "moments.list", {}, sessionToken);
  if (!Array.isArray(value)) assert(false, "Moments feed is not an array");
  return value.map((entry) => {
    const record = recordValue(entry);
    if (typeof record.id !== "string" || !Array.isArray(record.likes) || !Array.isArray(record.comments)) {
      assert(false, "Moments feed entry is invalid");
    }
    return {
      id: record.id,
      likes: record.likes.map((like) => {
        const data = recordValue(like);
        if (typeof data.accountId !== "string") assert(false, "Moment like is invalid");
        return { accountId: data.accountId };
      }),
      comments: record.comments.map((comment) => {
        const data = recordValue(comment);
        if (typeof data.id !== "string" || typeof data.authorId !== "string") {
          assert(false, "Moment comment is invalid");
        }
        return { id: data.id, authorId: data.authorId };
      })
    };
  });
}

async function exportAll(
  configuration: SmokeConfiguration,
  dependencies: SmokeDependencies,
  collection: "moments" | "momentLikes" | "momentComments"
): Promise<ExportPage["entries"]> {
  const entries: ExportPage["entries"] = [];
  let afterId: string | null = null;
  while (true) {
    const value = await invoke<unknown>(configuration, dependencies, "admin.exportPage", {
      collection,
      afterId,
      limit: 500,
      adminToken: configuration.adminToken
    });
    const page = exportPageValue(value);
    entries.push(...page.entries);
    if (page.nextCursor === null || page.entries.length < 500) return entries;
    assert(page.nextCursor !== afterId, "admin export cursor did not advance");
    afterId = page.nextCursor;
  }
}

function exportPageValue(value: unknown): ExportPage {
  const record = recordValue(value);
  if (!Array.isArray(record.entries) || (record.nextCursor !== null && typeof record.nextCursor !== "string")) {
    assert(false, "admin export page is invalid");
  }
  return {
    entries: record.entries.map((entry) => {
      const data = recordValue(entry);
      if (typeof data.id !== "string") assert(false, "admin export entry is invalid");
      return { id: data.id, data: recordValue(data.data) };
    }),
    nextCursor: record.nextCursor
  };
}

function sessionToken(value: Record<string, unknown>): string {
  if (typeof value.sessionToken !== "string") assert(false, "login response omitted the session");
  return value.sessionToken;
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    assert(false, "CloudBase response shape is invalid");
  }
  return value as Record<string, unknown>;
}

function feedContains(feedValue: MomentView[], momentId: string): boolean {
  return feedValue.some((moment) => moment.id === momentId);
}

async function bestEffort(operation: () => Promise<unknown>, failures: unknown[]): Promise<void> {
  try {
    await operation();
  } catch (error) {
    failures.push(error);
  }
}

async function expectApiError(operation: () => Promise<unknown>, expectedCode: string): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof AppError && error.code === expectedCode) return;
    throw new AppError("SMOKE_ASSERTION_FAILED", `Expected ${expectedCode} from smoke probe`);
  }
  throw new AppError("SMOKE_ASSERTION_FAILED", `Expected ${expectedCode} from smoke probe`);
}

function configurationValue(environment: Record<string, string | undefined>): SmokeConfiguration {
  return {
    functionUrl: requiredEnvironment(environment, "CLOUDBASE_FUNCTION_URL"),
    publishableKey: requiredEnvironment(environment, "CLOUDBASE_PUBLISHABLE_KEY"),
    adminToken: requiredEnvironment(environment, "BACKUP_ADMIN_TOKEN"),
    password1001: requiredEnvironment(environment, "SMOKE_PASSWORD_1001"),
    password1002: requiredEnvironment(environment, "SMOKE_PASSWORD_1002")
  };
}

function requiredEnvironment(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name];
  if (!value) throw new AppError("ENVIRONMENT_MISSING", `Missing environment variable ${name}`);
  return value;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new AppError("SMOKE_ASSERTION_FAILED", message);
}

function isDirectRun(): boolean {
  const script = process.argv[1];
  return script !== undefined && pathToFileURL(resolve(script)).href === import.meta.url;
}

if (isDirectRun()) {
  void main().catch(() => {
    process.stderr.write("Moments smoke check failed.\n");
    process.exitCode = 1;
  });
}
