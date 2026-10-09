import type { WenliMemoryRecord } from "../domain/wenli-memory.js";

export interface WenliMemoryStore {
  listForContext(limit: number): Promise<WenliMemoryRecord[]>;
  append(record: WenliMemoryRecord): Promise<WenliMemoryRecord>;
  listState?(limit: number): Promise<WenliMemoryRecord[]>;
}
