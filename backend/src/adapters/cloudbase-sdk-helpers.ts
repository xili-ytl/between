import type { CloudBase } from "@cloudbase/node-sdk";
import type { DocumentData } from "./cloudbase-stores.js";
import { assertDueArguments } from "./wenli-agent-job-stores.js";

export type CloudDatabase = ReturnType<CloudBase["database"]>;
export type CloudDocument = ReturnType<ReturnType<CloudDatabase["collection"]>["doc"]>;
export interface CloudTransaction { collection: CloudDatabase["collection"]; }

export function firstDocument(value: unknown): unknown { return Array.isArray(value) ? value[0] : value; }

export function cleanDocument(value: unknown): DocumentData | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { _id: ignored, ...document } = value as Record<string, unknown>;
  void ignored;
  return document;
}

export function throwResolvedCloudBaseError(result: unknown): void {
  if (typeof result === "object" && result !== null && "code" in result && result.code) throw result;
}

export async function readDocument(reference: CloudDocument): Promise<DocumentData | null> {
  const result = await reference.get();
  throwResolvedCloudBaseError(result);
  return cleanDocument(firstDocument(result.data));
}

export async function setDocument(reference: CloudDocument, data: DocumentData): Promise<void> {
  const result = await reference.set(data);
  throwResolvedCloudBaseError(result);
}

export async function queryDueWenliAgentJobDocuments(db: CloudDatabase, now: string, limit: number): Promise<DocumentData[]> {
  assertDueArguments(now, limit);
  const command = db.command;
  const results = await Promise.all([
    db.collection("wenliAgentJobs").where({ status: "pending", nextAttemptAt: command.lte(now) }).orderBy("nextAttemptAt", "asc").orderBy("_id", "asc").limit(limit).get(),
    db.collection("wenliAgentJobs").where({ status: "retry", nextAttemptAt: command.lte(now) }).orderBy("nextAttemptAt", "asc").orderBy("_id", "asc").limit(limit).get(),
    db.collection("wenliAgentJobs").where({ status: "running", leaseUntil: command.lte(now) }).orderBy("leaseUntil", "asc").orderBy("_id", "asc").limit(limit).get()
  ]);
  for (const result of results) throwResolvedCloudBaseError(result);
  return results.flatMap((result) => result.data.map(dueDocument)).sort((left, right) => dueAt(left).localeCompare(dueAt(right)) || String(left.id).localeCompare(String(right.id))).slice(0, limit);
}

function dueDocument(value: unknown): DocumentData {
  if (typeof value !== "object" || value === null || typeof (value as { _id?: unknown })._id !== "string") throw new Error("invalid Wenli due document");
  const id = (value as { _id: string })._id;
  const document = cleanDocument(value);
  if (!document || document.id !== id) throw new Error("invalid Wenli due document");
  return document;
}

function dueAt(document: DocumentData): string {
  const value = document.status === "running" ? document.leaseUntil : document.nextAttemptAt;
  if (typeof value !== "string") throw new Error("invalid Wenli due document");
  return value;
}
