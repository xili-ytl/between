import type { AccountId, MessageRecord, MessageSenderId } from "../domain/contracts.js";
import { WENLI_SENDER_ID } from "../domain/contracts.js";
import type { WenliAgentJob } from "../domain/wenli-agent.js";
import {
  deterministicWenliReplyId,
  assertValidWenliSource,
  buildWenliReply,
  existingWenliReplyMatches
} from "../domain/wenli-reply.js";
import type { WenliAgentJobStore } from "../ports/wenli-agent-job-store.js";
import type { MessageStore } from "../ports/stores.js";
import type {
  WenliJobClaimOptions,
  WenliJobExecutionStore,
  WenliJobFailureOptions
} from "../ports/wenli-job-execution-store.js";
import type { DocumentData } from "./cloudbase-stores.js";
import { parseWenliAgentJob, selectDueJobs } from "./wenli-agent-job-stores.js";
import { cleanDocument, firstDocument, queryDueWenliAgentJobDocuments, readDocument, setDocument, throwResolvedCloudBaseError, type CloudDatabase, type CloudDocument, type CloudTransaction } from "./cloudbase-sdk-helpers.js";

const JOBS = "wenliAgentJobs";
const MESSAGES = "messages";

import type { CloudBase } from "@cloudbase/node-sdk";

export class MemoryWenliJobExecutionStore implements WenliJobExecutionStore {
  private readonly jobs = new Map<string, WenliAgentJob>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly messages: MessageStore) {}

  async createIfAbsent(job: WenliAgentJob): Promise<WenliAgentJob> {
    const existing = this.jobs.get(job.id);
    if (existing) return structuredClone(existing);
    const stored = parseWenliAgentJob(job as unknown as DocumentData);
    this.jobs.set(stored.id, structuredClone(stored));
    return structuredClone(stored);
  }

  async get(jobId: string): Promise<WenliAgentJob | null> {
    const value = this.jobs.get(jobId);
    return value ? structuredClone(value) : null;
  }

  async listDue(now: string, limit: number): Promise<WenliAgentJob[]> {
    return selectDueJobs(this.jobs.values(), now, limit);
  }

  async claim(jobId: string, options: WenliJobClaimOptions): Promise<WenliAgentJob | null> {
    assertNonEmpty(jobId);
    assertClaimOptions(options);
    return this.transact(() => this.claimCurrent(jobId, options));
  }

  async source(jobId: string): Promise<MessageRecord | null> {
    assertNonEmpty(jobId);
    return this.messages.get(jobId);
  }

  async complete(jobId: string, token: string, now: string, body: unknown): Promise<MessageRecord | null> {
    assertNonEmpty(jobId);
    assertToken(token);
    isoTimestamp(now);
    return this.transact(() => this.completeCurrent(jobId, token, now, body));
  }

  async fail(jobId: string, token: string, now: string, failure: WenliJobFailureOptions): Promise<boolean> {
    assertNonEmpty(jobId);
    assertToken(token);
    isoTimestamp(now);
    assertFailureOptions(failure);
    return this.transact(() => this.failCurrent(jobId, token, now, failure));
  }

  private async transact<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release = () => {};
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async claimCurrent(jobId: string, options: WenliJobClaimOptions): Promise<WenliAgentJob | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const repaired = await this.repairExistingReply(job, options.now);
    if (repaired !== undefined) return repaired;
    if (job.type !== "mention") return null;
    if (job.status === "succeeded" || job.status === "dead") return null;
    if (job.status === "retry" && defined(job.nextAttemptAt).localeCompare(options.now) > 0) return null;
    if (job.status === "running" && defined(job.leaseUntil).localeCompare(options.now) > 0) return null;
    if (job.attemptCount >= options.maxAttempts) {
      this.jobs.set(jobId, deadJob(job, options.now));
      return null;
    }
    const claimed = runningJob(job, options);
    this.jobs.set(jobId, claimed);
    return structuredClone(claimed);
  }

  private async completeCurrent(jobId: string, token: string, now: string, body: unknown): Promise<MessageRecord | null> {
    const job = this.jobs.get(jobId);
    if (!isLiveLease(job, token, now)) return null;
    const source = await this.messages.get(defined(job.sourceMessageId));
    const replyId = deterministicWenliReplyId(jobId);
    const existing = await this.messages.get(replyId);
    const match = source ? existingWenliReplyMatches(job.requesterId, source, existing) : null;
    if (match === true) {
      this.succeed(job, replyId, now);
      return structuredClone(existing);
    }
    if (match === false) {
      this.dead(job, now, "WENLI_REPLY_INVALID");
      return null;
    }
    let reply: MessageRecord;
    try {
      assertValidWenliSource(job.requesterId, source);
      reply = buildWenliReply(job.requesterId, source, body, now);
    } catch (error) {
      this.dead(job, now, errorCode(error));
      return null;
    }
    await this.messages.appendIfAbsent(reply);
    this.succeed(job, reply.id, now);
    return structuredClone(reply);
  }

  private async failCurrent(jobId: string, token: string, now: string, failure: WenliJobFailureOptions): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!isLiveLease(job, token, now)) return false;
    const final = failure.permanent === true || failure.code === "WENLI_SOURCE_INVALID" ||
      failure.code === "WENLI_REPLY_INVALID" || job.attemptCount >= failure.maxAttempts;
    const updated: WenliAgentJob = final
      ? deadJob(job, now, failure.code)
      : retryJob(job, now, failure);
    this.jobs.set(jobId, updated);
    return true;
  }

  private async repairExistingReply(job: WenliAgentJob, now: string): Promise<WenliAgentJob | null | undefined> {
    if (job.type !== "mention") return undefined;
    const source = await this.messages.get(defined(job.sourceMessageId));
    const reply = await this.messages.get(deterministicWenliReplyId(job.id));
    if (!source || !reply) return undefined;
    const match = existingWenliReplyMatches(job.requesterId, source, reply);
    if (match === true) {
      this.jobs.set(job.id, succeededJob(job, reply.id, now));
      return null;
    }
    this.dead(job, now, "WENLI_REPLY_INVALID");
    return null;
  }

  private succeed(job: WenliAgentJob, responseMessageId: string, now: string): void {
    this.jobs.set(job.id, succeededJob(job, responseMessageId, now));
  }

  private dead(job: WenliAgentJob, now: string, code: string): void {
    this.jobs.set(job.id, deadJob(job, now, code));
  }
}

export class CloudBaseWenliJobExecutionStore implements WenliJobExecutionStore, WenliAgentJobStore {
  private readonly db: CloudDatabase;

  constructor(app: CloudBase) {
    this.db = app.database();
  }

  async createIfAbsent(job: WenliAgentJob): Promise<WenliAgentJob> {
    const valid = parseWenliAgentJob(job as unknown as DocumentData);
    return this.db.runTransaction(async (transaction: CloudTransaction) => {
      const reference = transaction.collection(JOBS).doc(valid.id);
      const result = await reference.get();
      throwResolvedCloudBaseError(result);
      const existing = cleanDocument(firstDocument(result.data));
      if (existing) return parseWenliAgentJob(existing);
      const setResult = await reference.set({ ...valid });
      throwResolvedCloudBaseError(setResult);
      return structuredClone(valid);
    });
  }

  async get(jobId: string): Promise<WenliAgentJob | null> {
    assertNonEmpty(jobId);
    const document = await readDocument(this.db.collection(JOBS).doc(jobId));
    return document ? parseWenliAgentJob(document) : null;
  }

  async listDue(now: string, limit: number): Promise<WenliAgentJob[]> {
    return selectDueJobs((await queryDueWenliAgentJobDocuments(this.db, now, limit)).map(parseWenliAgentJob), now, limit);
  }

  async claim(jobId: string, options: WenliJobClaimOptions): Promise<WenliAgentJob | null> {
    assertNonEmpty(jobId);
    assertClaimOptions(options);
    return this.db.runTransaction(async (transaction: CloudTransaction) => {
      const refs = refsFor(transaction, jobId);
      const job = await readJob(refs.job);
      if (!job) return null;
      const repaired = await repairExistingReplyInTransaction(refs, job, options.now);
      if (repaired !== undefined) return repaired;
      if (job.type !== "mention") return null;
      if (job.status === "succeeded" || job.status === "dead") return null;
      if (job.status === "retry" && defined(job.nextAttemptAt).localeCompare(options.now) > 0) return null;
      if (job.status === "running" && defined(job.leaseUntil).localeCompare(options.now) > 0) return null;
      if (job.attemptCount >= options.maxAttempts) {
        await setJob(refs.job, deadJob(job, options.now));
        return null;
      }
      const claimed = runningJob(job, options);
      await setJob(refs.job, claimed);
      return structuredClone(claimed);
    });
  }

  async source(jobId: string): Promise<MessageRecord | null> {
    assertNonEmpty(jobId);
    const document = await readDocument(this.db.collection(MESSAGES).doc(jobId));
    return document ? parseMessage(document) : null;
  }

  async complete(jobId: string, token: string, now: string, body: unknown): Promise<MessageRecord | null> {
    assertNonEmpty(jobId);
    assertToken(token);
    isoTimestamp(now);
    return this.db.runTransaction(async (transaction: CloudTransaction) => {
      const refs = refsFor(transaction, jobId);
      const job = await readJob(refs.job);
      if (!isLiveLease(job, token, now)) return null;
      const sourceResult = await readMessageResult(refs.source);
      if (sourceResult.kind === "invalid") {
        await setJob(refs.job, deadJob(job, now, "WENLI_SOURCE_INVALID"));
        return null;
      }
      const replyResult = await readMessageResult(refs.reply);
      if (replyResult.kind === "invalid") {
        await setJob(refs.job, deadJob(job, now, "WENLI_REPLY_INVALID"));
        return null;
      }
      const source = sourceResult.message;
      const reply = replyResult.message;
      const match = source ? existingWenliReplyMatches(job.requesterId, source, reply) : null;
      if (match === true) {
        await setJob(refs.job, succeededJob(job, reply!.id, now));
        return reply;
      }
      if (match === false) {
        await setJob(refs.job, deadJob(job, now, "WENLI_REPLY_INVALID"));
        return null;
      }
      let built: MessageRecord;
      try {
        assertValidWenliSource(job.requesterId, source);
        built = buildWenliReply(job.requesterId, source, body, now);
      } catch (error) {
        await setJob(refs.job, deadJob(job, now, errorCode(error)));
        return null;
      }
      const setResult = await refs.reply.set({ ...built });
      throwResolvedCloudBaseError(setResult);
      await setJob(refs.job, succeededJob(job, built.id, now));
      return structuredClone(built);
    });
  }

  async fail(jobId: string, token: string, now: string, failure: WenliJobFailureOptions): Promise<boolean> {
    assertNonEmpty(jobId);
    assertToken(token);
    isoTimestamp(now);
    assertFailureOptions(failure);
    return this.db.runTransaction(async (transaction: CloudTransaction) => {
      const ref = transaction.collection(JOBS).doc(jobId);
      const job = await readJob(ref);
      if (!isLiveLease(job, token, now)) return false;
      const final = failure.permanent === true || failure.code === "WENLI_SOURCE_INVALID" ||
        failure.code === "WENLI_REPLY_INVALID" || job.attemptCount >= failure.maxAttempts;
      const updated = final
        ? deadJob(job, now, failure.code)
        : retryJob(job, now, failure);
      await setJob(ref, updated);
      return true;
    });
  }
}

async function repairExistingReplyInTransaction(
  refs: ReturnType<typeof refsFor>,
  job: WenliAgentJob,
  now: string
): Promise<null | undefined> {
  if (job.type !== "mention") return undefined;
  const sourceResult = await readMessageResult(refs.source);
  const replyResult = await readMessageResult(refs.reply);
  if (replyResult.kind === "invalid") {
    await setJob(refs.job, deadJob(job, now, "WENLI_REPLY_INVALID"));
    return null;
  }
  if (sourceResult.kind === "invalid") {
    await setJob(refs.job, deadJob(job, now, "WENLI_SOURCE_INVALID"));
    return null;
  }
  const source = sourceResult.message;
  const reply = replyResult.message;
  if (!source || !reply) return undefined;
  const match = existingWenliReplyMatches(job.requesterId, source, reply);
  await setJob(refs.job, match
    ? succeededJob(job, reply.id, now)
    : deadJob(job, now, "WENLI_REPLY_INVALID"));
  return null;
}

function refsFor(transaction: CloudTransaction, jobId: string) {
  return {
    job: transaction.collection(JOBS).doc(jobId),
    source: transaction.collection(MESSAGES).doc(jobId),
    reply: transaction.collection(MESSAGES).doc(deterministicWenliReplyId(jobId))
  };
}

async function readJob(reference: CloudDocument): Promise<WenliAgentJob | null> {
  const document = await readDocument(reference);
  return document ? parseWenliAgentJob(document) : null;
}

async function readMessage(reference: CloudDocument): Promise<MessageRecord | null> {
  const document = await readDocument(reference);
  return document ? parseMessage(document) : null;
}

async function readMessageResult(reference: CloudDocument): Promise<
  | { kind: "missing"; message: null }
  | { kind: "valid"; message: MessageRecord }
  | { kind: "invalid"; message: null }
> {
  const document = await readDocument(reference);
  if (!document) return { kind: "missing", message: null };
  try {
    return { kind: "valid", message: parseMessage(document) };
  } catch {
    return { kind: "invalid", message: null };
  }
}

async function setJob(reference: CloudDocument, job: WenliAgentJob): Promise<void> {
  await setDocument(reference, { ...job });
}

function succeededJob(job: WenliAgentJob, responseMessageId: string, now: string): WenliAgentJob {
  const { leaseToken, leaseUntil, nextAttemptAt, lastErrorCode, ...base } = job;
  void leaseToken;
  void leaseUntil;
  void nextAttemptAt;
  void lastErrorCode;
  return { ...base, status: "succeeded", responseMessageId, updatedAt: now };
}

function deadJob(job: WenliAgentJob, now: string, code?: string): WenliAgentJob {
  const { leaseToken, leaseUntil, nextAttemptAt, lastErrorCode, ...base } = job;
  void leaseToken;
  void leaseUntil;
  void nextAttemptAt;
  void lastErrorCode;
  return { ...base, status: "dead", ...(code === undefined ? {} : { lastErrorCode: code }), updatedAt: now };
}

function runningJob(job: WenliAgentJob, options: WenliJobClaimOptions): WenliAgentJob {
  const { nextAttemptAt, lastErrorCode, ...base } = job;
  void nextAttemptAt;
  void lastErrorCode;
  return {
    ...base,
    status: "running",
    attemptCount: job.attemptCount + 1,
    leaseToken: options.token,
    leaseUntil: addMs(options.now, options.leaseMs),
    updatedAt: options.now
  };
}

function retryJob(job: WenliAgentJob, now: string, failure: WenliJobFailureOptions): WenliAgentJob {
  const { leaseToken, leaseUntil, ...base } = job;
  void leaseToken;
  void leaseUntil;
  return {
    ...base,
    status: "retry",
    nextAttemptAt: addMs(now, Math.min(failure.maxDelayMs, failure.baseDelayMs * (2 ** Math.max(0, job.attemptCount - 1)))),
    lastErrorCode: failure.code,
    updatedAt: now
  };
}

function isLiveLease(job: WenliAgentJob | null | undefined, token: string, now: string): job is WenliAgentJob {
  return !!job && job.status === "running" && job.leaseToken === token && defined(job.leaseUntil).localeCompare(now) > 0;
}

function parseMessage(value: DocumentData): MessageRecord {
  const senderId = messageSender(value.senderId);
  const recipientId = account(value.recipientId);
  const replyToMessageId = optionalString(value.replyToMessageId);
  const sourceMessageId = optionalString(value.sourceMessageId);
  const type = value.type === undefined ? undefined : messageType(value.type);
  const imageFileId = optionalString(value.imageFileId);
  const imageMimeType = optionalString(value.imageMimeType) as MessageRecord["imageMimeType"] | undefined;
  const imageWidth = value.imageWidth === undefined ? undefined : finiteNumber(value.imageWidth);
  const imageHeight = value.imageHeight === undefined ? undefined : finiteNumber(value.imageHeight);
  return {
    id: requiredString(value.id),
    relationshipId: relationship(value.relationshipId),
    senderId,
    recipientId,
    clientMessageId: requiredString(value.clientMessageId),
    body: requiredString(value.body),
    ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
    ...(sourceMessageId === undefined ? {} : { sourceMessageId }),
    ...(type === undefined ? {} : { type }),
    ...(imageFileId === undefined ? {} : { imageFileId }),
    ...(imageMimeType === undefined ? {} : { imageMimeType }),
    ...(imageWidth === undefined ? {} : { imageWidth }),
    ...(imageHeight === undefined ? {} : { imageHeight }),
    createdAt: isoTimestamp(requiredString(value.createdAt))
  };
}

function assertClaimOptions(options: WenliJobClaimOptions): void {
  isoTimestamp(options.now);
  assertToken(options.token);
  boundedInteger(options.leaseMs, MAX_DELAY_MS);
  boundedInteger(options.maxAttempts, MAX_ATTEMPTS);
}

function assertFailureOptions(failure: WenliJobFailureOptions): void {
  if (failure.code !== "WENLI_GENERATION_FAILED" && failure.code !== "WENLI_GENERATION_TIMEOUT" &&
    failure.code !== "WENLI_SOURCE_INVALID" && failure.code !== "WENLI_REPLY_INVALID") {
    throw new Error("invalid Wenli failure");
  }
  boundedInteger(failure.maxAttempts, MAX_ATTEMPTS);
  boundedInteger(failure.baseDelayMs, MAX_DELAY_MS);
  boundedInteger(failure.maxDelayMs, MAX_DELAY_MS);
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error &&
    (error.code === "WENLI_SOURCE_INVALID" || error.code === "WENLI_REPLY_INVALID")) {
    return error.code;
  }
  return "WENLI_GENERATION_FAILED";
}

function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

function defined(value: string | undefined): string {
  if (value === undefined) throw new Error("invalid Wenli job");
  return value;
}

function assertNonEmpty(value: string): void {
  if (typeof value !== "string" || value.length === 0) throw new Error("invalid Wenli argument");
}

function assertToken(value: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 200) throw new Error("invalid Wenli argument");
}

function isoTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) throw new Error("invalid Wenli timestamp");
  return value;
}

const MAX_DELAY_MS = 2_147_483_647;
const MAX_ATTEMPTS = 100;

function boundedInteger(value: number, max: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error("invalid Wenli argument");
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("invalid message document");
  return value;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : requiredString(value);
}

function account(value: unknown): AccountId {
  if (value !== "1001" && value !== "1002") throw new Error("invalid account id");
  return value;
}

function messageSender(value: unknown): MessageSenderId {
  if (value === WENLI_SENDER_ID) return WENLI_SENDER_ID;
  return account(value);
}

function relationship(value: unknown): "couple" {
  if (value !== "couple") throw new Error("invalid relationship id");
  return value;
}

function messageType(value: unknown): "text" | "image" {
  if (value !== "text" && value !== "image") throw new Error("invalid message type");
  return value;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("invalid number");
  return value;
}
