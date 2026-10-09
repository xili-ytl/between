import { describe, expect, it } from "vitest";
import { selectWenliBackground, selectWenliMemories } from "../src/domain/wenli-context-selection.js";
import type { WenliBackgroundFact } from "../src/domain/wenli-persona-source.js";
import type { WenliMemoryRecord } from "../src/domain/wenli-memory.js";

const facts: WenliBackgroundFact[] = [
  { id: "origin", subject: "couple", text: "名字来自两位主人。", topic: "origin", sensitive: false, asOf: "2026-09-12" },
  { id: "school", subject: "1002", text: "在合成大学学习。", topic: "school", sensitive: false, asOf: "2026-09-12" },
  { id: "health", subject: "1001", text: "合成敏感事实。", topic: "health", sensitive: true, asOf: "2026-09-12" }
];
const memory = (id: string, summary: string, extra: Partial<WenliMemoryRecord> = {}): WenliMemoryRecord => ({
  id, summary, kind: "fact", speakerIds: ["1002"], sourceEventIds: ["1002_synthetic"], salience: 50,
  status: "active", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...extra
});

describe("context selection before model invocation", () => {
  it("recalls corrected school facts by topic for the authenticated subject, not the source speaker", () => {
    const records = [memory("mine", "我还没开始读高三", {subjectId:"1001",topicKey:"profile.school",operation:"correct",speakerIds:["1002"]}), memory("other", "我在合成大学", {subjectId:"1002",topicKey:"profile.school",operation:"remember"})];
    expect(selectWenliMemories("我现在读几年级", records, "2026-09-13T00:00:00.000Z", 4, "1001").map(r=>r.id)).toEqual(["mine"]);
    expect(selectWenliMemories("示例甲在哪所学校", records, "2026-09-13T00:00:00.000Z", 4, "1001").map(r=>r.id)).toEqual(["other"]);
  });
  it("does not let a future correction shadow a currently valid fact", () => {
    const records = [memory("old", "喜欢蓝色杯子", {subjectId:"1001",topicKey:"preference.cup",operation:"remember"}), memory("future", "喜欢红色杯子", {subjectId:"1001",topicKey:"preference.cup",operation:"correct",updatedAt:"2026-09-12T00:00:00.000Z",validFrom:"2027-01-01T00:00:00.000Z"})];
    expect(selectWenliMemories("杯子是什么颜色", records, "2026-09-13T00:00:00.000Z",4,"1001").map(r=>r.id)).toEqual(["old"]);
  });
  it("does not load a profile for greetings, identities, emoticons or algorithm questions", () => {
    for (const query of ["@问理 你好", "qwq", "我是谁", "你是谁", "讲一下矩阵快速幂"]) {
      expect(selectWenliBackground(query, "1002", facts)).toEqual([]);
    }
  });
  it("recalls the specific story or owner fact, including mixed greetings and a real question", () => {
    expect(selectWenliBackground("你为什么叫问理", "1001", facts).map(fact => fact.id)).toEqual(["origin"]);
    expect(selectWenliBackground("你好呀，我在哪所大学", "1002", facts).map(fact => fact.id)).toEqual(["school"]);
    expect(selectWenliBackground("我在哪所大学", "1001", facts)).toEqual([]);
    expect(selectWenliBackground("示例甲在哪所大学", "1001", facts).map(fact => fact.id)).toEqual(["school"]);
  });
  it("requires explicit sensitive-topic relevance instead of a vague care request", () => {
    expect(selectWenliBackground("关心一下示例乙", "1002", facts)).toEqual([]);
    expect(selectWenliBackground("示例乙的养病情况", "1002", facts).map(fact => fact.id)).toEqual(["health"]);
  });
  it("filters stale, retracted, assistant-sourced and unrelated memories before ranking", () => {
    const records = [memory("mem_active", "喜欢蓝色杯子"), memory("mem_stale", "喜欢蓝色杯子", { validTo: "2026-09-11T00:00:00.000Z" }),
      memory("mem_retracted", "喜欢蓝色杯子", { status: "retracted" }), memory("mem_bot", "喜欢蓝色杯子", { speakerIds: ["wenli"] }), memory("mem_other", "周末打羽毛球")];
    expect(selectWenliMemories("蓝色杯子还记得吗", records, "2026-09-12T00:00:00.000Z").map(value => value.id)).toEqual(["mem_active"]);
    expect(selectWenliMemories("你好", records, "2026-09-12T00:00:00.000Z")).toEqual([]);
  });
});
