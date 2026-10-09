import type { AccountId } from "./contracts.js";

export type WenliMemoryKind = "fact" | "event" | "preference" | "plan" | "boundary";

export type WenliMemoryStatus = "active" | "superseded" | "retracted";

export interface WenliMemoryRecord {
  id: string;
  kind: WenliMemoryKind;
  summary: string;
  speakerIds: Array<AccountId | "wenli">;
  sourceEventIds: string[];
  salience: number;
  status: WenliMemoryStatus;
  supersedesId?: string;
  validFrom?: string;
  validTo?: string;
  createdAt: string;
  updatedAt: string;
  subjectId?: AccountId;
  topicKey?: string;
  operation?: "remember" | "correct" | "forget";
  sensitive?: boolean;
}

export function buildWenliFactMemory(input: {
  id: string;
  requesterId: AccountId;
  sourceMessageId: string;
  summary: string;
  now: string;
}): WenliMemoryRecord {
  return parseWenliMemoryRecord({
    id: input.id,
    kind: "fact",
    summary: input.summary,
    speakerIds: [input.requesterId],
    sourceEventIds: [input.sourceMessageId],
    salience: 50,
    status: "active",
    createdAt: input.now,
    updatedAt: input.now
  });
}

export function parseWenliMemoryRecord(value: unknown): WenliMemoryRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  const id = memoryIdValue(record.id);
  const kind = memoryKindValue(record.kind);
  const summary = summaryValue(record.summary);
  const speakerIds = speakerIdsValue(record.speakerIds);
  const sourceEventIds = sourceEventIdsValue(record.sourceEventIds);
  if (typeof record.salience !== "number" || !Number.isFinite(record.salience) ||
      record.salience < 0 || record.salience > 100) invalid();
  const status = memoryStatusValue(record.status);
  const supersedesId = record.supersedesId === undefined ? undefined : memoryIdValue(record.supersedesId);
  const validFrom = record.validFrom === undefined ? undefined : isoTimestampValue(record.validFrom);
  const validTo = record.validTo === undefined ? undefined : isoTimestampValue(record.validTo);
  const structured = record.subjectId !== undefined || record.topicKey !== undefined || record.operation !== undefined || record.sensitive !== undefined;
  if (structured && ((record.subjectId !== "1002" && record.subjectId !== "1001") ||
    typeof record.topicKey !== "string" || !/^(preference|profile|plan|boundary|event)\.[a-z0-9][a-z0-9_.-]{0,63}$/u.test(record.topicKey) ||
    (record.operation !== "remember" && record.operation !== "correct" && record.operation !== "forget") || typeof record.sensitive !== "boolean")) invalid();
  return {
    id,
    kind,
    summary,
    speakerIds,
    sourceEventIds,
    salience: record.salience,
    status,
    ...(supersedesId === undefined ? {} : { supersedesId }),
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validTo === undefined ? {} : { validTo }),
    createdAt: isoTimestampValue(record.createdAt),
    updatedAt: isoTimestampValue(record.updatedAt),
    ...(structured ? { subjectId: record.subjectId as AccountId, topicKey: record.topicKey as string, operation: record.operation as "remember" | "correct" | "forget", sensitive: record.sensitive as boolean } : {})
  };
}

function invalid(): never {
  throw new Error("Invalid Wenli memory record");
}

function memoryIdValue(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("mem_")) invalid();
  return value;
}

function memoryKindValue(value: unknown): WenliMemoryKind {
  if (value === "fact" || value === "event" || value === "preference" ||
      value === "plan" || value === "boundary") {
    return value;
  }
  invalid();
}

function memoryStatusValue(value: unknown): WenliMemoryStatus {
  if (value === "active" || value === "superseded" || value === "retracted") {
    return value;
  }
  invalid();
}

function summaryValue(value: unknown): string {
  if (typeof value !== "string") invalid();
  const summary = value.trim();
  const length = [...summary].length;
  if (length < 1 || length > 2000) invalid();
  return summary;
}

function speakerIdsValue(value: unknown): WenliMemoryRecord["speakerIds"] {
  if (!Array.isArray(value) || value.length === 0 ||
      value.some((id) => id !== "1001" && id !== "1002" && id !== "wenli")) invalid();
  return [...value] as WenliMemoryRecord["speakerIds"];
}

function sourceEventIdsValue(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 ||
      value.some((id) => typeof id !== "string" || id.length === 0)) invalid();
  return [...value];
}

function isoTimestampValue(value: unknown): string {
  if (typeof value !== "string") invalid();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) invalid();
  return value;
}
