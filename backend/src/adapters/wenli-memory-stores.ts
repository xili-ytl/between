import type { CloudPersistence, DocumentData } from "./cloudbase-stores.js";
import { parseWenliMemoryRecord, type WenliMemoryRecord } from "../domain/wenli-memory.js";
import { effectiveMemories } from "../domain/wenli-memory-candidate.js";
import type { WenliMemoryStore } from "../ports/wenli-memory-store.js";

const COLLECTION = "wenliMemories";
const QUERY_LIMIT = 200;

export class MemoryWenliMemoryStore implements WenliMemoryStore {
  private readonly records = new Map<string, WenliMemoryRecord>();

  async listState(limit: number): Promise<WenliMemoryRecord[]> {
    assertContextLimit(limit);
    return [...this.records.values()].sort(compareForContext).slice(0,limit).map(record => structuredClone(record));
  }

  async listForContext(limit: number): Promise<WenliMemoryRecord[]> {
    assertContextLimit(limit);
    return effectiveMemories([...this.records.values()])
      .sort(compareForContext)
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async append(record: WenliMemoryRecord): Promise<WenliMemoryRecord> {
    const valid = parseWenliMemoryRecord(record);
    const existing = this.records.get(valid.id);
    if (existing) return structuredClone(existing);
    this.records.set(valid.id, structuredClone(valid));
    return structuredClone(valid);
  }
}

export class CloudBaseWenliMemoryStore implements WenliMemoryStore {
  constructor(private readonly cloud: CloudPersistence) {}

  async listState(limit: number): Promise<WenliMemoryRecord[]> {
    assertContextLimit(limit);
    return (await this.cloud.queryWenliMemories(QUERY_LIMIT)).map(entry => parseCloudMemoryDocument(entry.id,entry.data)).sort(compareForContext).slice(0,limit);
  }

  async listForContext(limit: number): Promise<WenliMemoryRecord[]> {
    assertContextLimit(limit);
    return effectiveMemories((await this.cloud.queryWenliMemories(QUERY_LIMIT))
      .map((entry) => parseCloudMemoryDocument(entry.id, entry.data)))
      .sort(compareForContext)
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async append(record: WenliMemoryRecord): Promise<WenliMemoryRecord> {
    const valid = parseWenliMemoryRecord(record);
    const document = await this.cloud.putIfAbsent(COLLECTION, valid.id, { ...valid });
    return parseCloudMemoryDocument(valid.id, document);
  }
}

function parseCloudMemoryDocument(id: string, document: DocumentData): WenliMemoryRecord {
  if (document.id !== undefined && document.id !== id) {
    throw new Error("Invalid Wenli memory record");
  }
  return parseWenliMemoryRecord({ ...document, id });
}

function assertContextLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("invalid Wenli memory limit");
  }
}

function compareForContext(left: WenliMemoryRecord, right: WenliMemoryRecord): number {
  return right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
}
