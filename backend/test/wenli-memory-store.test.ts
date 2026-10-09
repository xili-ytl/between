import { describe, expect, it } from "vitest";
import { MemoryWenliMemoryStore } from "../src/adapters/wenli-memory-stores.js";
import {
  buildWenliFactMemory,
  parseWenliMemoryRecord,
  type WenliMemoryRecord
} from "../src/domain/wenli-memory.js";

const fact: WenliMemoryRecord = {
  id: "mem_20260901_1",
  kind: "fact",
  summary: "示例甲最近在学滑板",
  speakerIds: ["1001"],
  sourceEventIds: ["1001_ask-1"],
  salience: 50,
  status: "active",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z"
};

describe("MemoryWenliMemoryStore", () => {
  it("builds canonical fact memory from a source message", () => {
    expect(buildWenliFactMemory({
      id: "mem_20260901_fact",
      requesterId: "1002",
      sourceMessageId: "1002_source-1",
      summary: "  示例甲最近在学滑板  ",
      now: "2026-09-01T00:00:00.000Z"
    })).toEqual({
      id: "mem_20260901_fact",
      kind: "fact",
      summary: "示例甲最近在学滑板",
      speakerIds: ["1002"],
      sourceEventIds: ["1002_source-1"],
      salience: 50,
      status: "active",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    });
  });

  it("appends once with duplicate conflicting payload retaining the first memory", async () => {
    const store = new MemoryWenliMemoryStore();
    await expect(store.append(fact)).resolves.toEqual(fact);

    await expect(store.append({
      ...fact,
      summary: "不能覆盖",
      speakerIds: ["1002"],
      salience: 100
    })).resolves.toEqual(fact);

    expect(await store.listForContext(10)).toEqual([fact]);
  });

  it.each([
    { name: "blank summary", patch: { summary: " " } },
    { name: "NaN salience", patch: { salience: NaN } }
  ])("rejects invalid duplicate append input before idempotent lookup: $name", async ({ patch }) => {
    const store = new MemoryWenliMemoryStore();
    await store.append(fact);

    await expect(store.append({ ...fact, ...patch })).rejects.toThrow("Invalid Wenli memory record");
    expect(await store.listForContext(10)).toEqual([fact]);
  });

  it("lists only active memories by updated time and id with bounded limits", async () => {
    const store = new MemoryWenliMemoryStore();
    await store.append(fact);
    await store.append({
      ...fact,
      id: "mem_20260901_2",
      summary: "示例乙喜欢海",
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z"
    });
    await store.append({
      ...fact,
      id: "mem_20260901_3",
      summary: "旧计划已撤回",
      status: "retracted",
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z"
    });
    await store.append({
      ...fact,
      id: "mem_20260901_4",
      summary: "同一时间较小 id",
      updatedAt: "2026-09-02T00:00:00.000Z"
    });

    expect((await store.listForContext(2)).map((m) => m.id))
      .toEqual(["mem_20260901_4", "mem_20260901_2"]);
  });

  it.each([0, -1, 201, 1.5, NaN, Infinity])("rejects invalid context limit %s", async (limit) => {
    const store = new MemoryWenliMemoryStore();
    await expect(store.listForContext(limit)).rejects.toThrow("invalid Wenli memory limit");
  });

  it("returns defensive clones that cannot mutate storage", async () => {
    const store = new MemoryWenliMemoryStore();
    const appended = await store.append(fact);
    appended.summary = "mutated";
    appended.speakerIds.push("wenli");

    const [listed] = await store.listForContext(10);
    listed!.sourceEventIds.push("forged");

    expect(await store.listForContext(10)).toEqual([fact]);
  });

  it.each([
    { name: "non canonical id", patch: { id: "bad" } },
    { name: "coerced kind", patch: { kind: { toString: () => "fact" } } },
    { name: "blank summary", patch: { summary: "   " } },
    { name: "overlong summary", patch: { summary: "字".repeat(2001) } },
    { name: "empty speakers", patch: { speakerIds: [] } },
    { name: "unknown speaker", patch: { speakerIds: ["robot"] } },
    { name: "empty source events", patch: { sourceEventIds: [] } },
    { name: "blank source event", patch: { sourceEventIds: [""] } },
    { name: "infinite salience", patch: { salience: Infinity } },
    { name: "out of range salience", patch: { salience: 101 } },
    { name: "coerced status", patch: { status: { toString: () => "active" } } },
    { name: "numeric supersedes id", patch: { supersedesId: 7 } },
    { name: "invalid validFrom", patch: { validFrom: "tomorrow" } },
    { name: "invalid validTo", patch: { validTo: "tomorrow" } },
    { name: "invalid createdAt", patch: { createdAt: "today" } },
    { name: "invalid updatedAt", patch: { updatedAt: "today" } }
  ])("rejects invalid memory records: $name", ({ patch }) => {
    expect(() => parseWenliMemoryRecord({ ...fact, ...patch })).toThrow("Invalid Wenli memory record");
  });
});
