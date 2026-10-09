import type { WenliAgentJob } from "../domain/wenli-agent.js";
import type { WenliAgentJobStore } from "../ports/wenli-agent-job-store.js";
import type { CloudPersistence, DocumentData } from "./cloudbase-stores.js";

const COLLECTION = "wenliAgentJobs";

export class MemoryWenliAgentJobStore implements WenliAgentJobStore {
  private readonly records = new Map<string, WenliAgentJob>();

  async createIfAbsent(job: WenliAgentJob): Promise<WenliAgentJob> {
    const existing = this.records.get(job.id);
    if (existing) return structuredClone(existing);
    this.records.set(job.id, structuredClone(job));
    return structuredClone(job);
  }

  async get(jobId: string): Promise<WenliAgentJob | null> {
    const value = this.records.get(jobId);
    return value ? structuredClone(value) : null;
  }

  async listDue(now: string, limit: number): Promise<WenliAgentJob[]> {
    return selectDueJobs([...this.records.values()], now, limit);
  }
}

export class CloudBaseWenliAgentJobStore implements WenliAgentJobStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async createIfAbsent(job: WenliAgentJob): Promise<WenliAgentJob> {
    return parseWenliAgentJob(await this.cloud.putIfAbsent(COLLECTION, job.id, { ...job }));
  }

  async get(jobId: string): Promise<WenliAgentJob | null> {
    const value = await this.cloud.getDocument(COLLECTION, jobId);
    return value === null ? null : parseWenliAgentJob(value);
  }

  async listDue(now: string, limit: number): Promise<WenliAgentJob[]> {
    assertDueArguments(now, limit);
    return selectDueJobs((await this.cloud.queryDueWenliAgentJobs(now, limit)).map(parseWenliAgentJob), now, limit);
  }
}

export function selectDueJobs(jobs: Iterable<WenliAgentJob>, now: string, limit: number): WenliAgentJob[] {
  assertDueArguments(now, limit);
  return [...jobs].filter((job) => {
    const dueAt = job.status === "running" ? job.leaseUntil : (job.status === "pending" || job.status === "retry" ? job.nextAttemptAt : undefined);
    return dueAt !== undefined && dueAt.localeCompare(now) <= 0;
  }).sort((left, right) => dueAt(left).localeCompare(dueAt(right)) || left.id.localeCompare(right.id)).slice(0, limit).map((job) => structuredClone(job));
}

export function assertDueArguments(now: string, limit: number): void {
  const date = new Date(now);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || typeof now !== "string" || Number.isNaN(date.getTime()) || date.toISOString() !== now) {
    throw new Error("invalid Wenli argument");
  }
}

function dueAt(job: WenliAgentJob): string {
  const value = job.status === "running" ? job.leaseUntil : job.nextAttemptAt;
  if (!value) throw new Error("invalid Wenli job");
  return value;
}

export function parseWenliAgentJob(value: DocumentData): WenliAgentJob {
  const id = requiredString(value.id);
  const requesterId = value.requesterId;
  if (requesterId !== "1001" && requesterId !== "1002") invalidJob();
  const type = value.type;
  if (type !== "mention" && type !== "warmup") invalidJob();
  const status = value.status;
  if (status !== "pending" && status !== "running" && status !== "retry" &&
    status !== "succeeded" && status !== "dead") invalidJob();
  const attemptCount = value.attemptCount;
  if (typeof attemptCount !== "number" || !Number.isInteger(attemptCount) || attemptCount < 0) invalidJob();

  const sourceMessageId = optionalString(value.sourceMessageId);
  if ((type === "mention" && (sourceMessageId === undefined || sourceMessageId !== id)) ||
    (type === "warmup" && sourceMessageId !== undefined)) invalidJob();
  const responseMessageId = optionalString(value.responseMessageId);
  const lastErrorCode = optionalString(value.lastErrorCode);
  const leaseToken = optionalString(value.leaseToken);

  return {
    id,
    type,
    requesterId,
    ...(sourceMessageId === undefined ? {} : { sourceMessageId }),
    status,
    attemptCount,
    ...(value.nextAttemptAt === undefined ? {} : { nextAttemptAt: isoTimestamp(value.nextAttemptAt) }),
    ...(value.leaseUntil === undefined ? {} : { leaseUntil: isoTimestamp(value.leaseUntil) }),
    ...(leaseToken === undefined ? {} : { leaseToken }),
    ...(responseMessageId === undefined ? {} : { responseMessageId }),
    ...(lastErrorCode === undefined ? {} : { lastErrorCode }),
    createdAt: isoTimestamp(value.createdAt),
    updatedAt: isoTimestamp(value.updatedAt)
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) invalidJob();
  return value;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : requiredString(value);
}

function isoTimestamp(value: unknown): string {
  const timestamp = requiredString(value);
  let normalized: string;
  try {
    normalized = new Date(timestamp).toISOString();
  } catch {
    return invalidJob();
  }
  if (normalized !== timestamp) invalidJob();
  return timestamp;
}

function invalidJob(): never {
  throw new Error("Invalid Wenli agent job");
}
