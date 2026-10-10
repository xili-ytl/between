import { describe, expect, it } from "vitest";
import { buildSourcedMemory, effectiveMemories, resolveWenliMemoryMutation } from "../src/domain/wenli-memory-candidate.js";
import type { MessageRecord } from "../src/domain/contracts.js";
const source = (body: string): MessageRecord => ({id:"1002_source",clientMessageId:"source",senderId:"1002",recipientId:"1001",relationshipId:"couple",body,createdAt:"2026-09-12T00:00:00.000Z"});
const input = {quote:"我喜欢蓝色杯子",subjectId:"1002",topicKey:"preference.cup",kind:"preference",operation:"remember"};
describe("sourced durable memory", () => {
  it.each([
    "忘记我的蓝色手机偏好", "忘记我的杯子偏好吗", "忘记我的杯子偏好是不可以的",
    "不要忘记我的杯子偏好", "我不想忘记我的杯子偏好", "请别忘记我的杯子偏好",
    "忘记我的杯子和咖啡偏好", "忘记我的杯子偏好的话会怎样", "忘记示例乙的杯子偏好"
  ])("does not retract a cup preference for an unrelated, negative or ambiguous request: %s", body => {
    const previous = buildSourcedMemory(input, source("我喜欢蓝色杯子"))!;
    const command = { ...source(`@小Q ${body}`), id: "1002_forget", clientMessageId: "forget", createdAt: "2026-09-13T00:00:00.000Z" };
    for (const candidate of [null, { ...input, quote: body, operation: "forget" }]) {
      expect(resolveWenliMemoryMutation(candidate, command, [previous])).toBeNull();
    }
  });
  it.each(["忘记我的杯子偏好", "别再记我的杯子偏好", "不要再记我的杯子偏好", "请忘记示例甲的杯子偏好，谢谢！"])("accepts a single affirmative owner retraction: %s", body => {
    const previous = buildSourcedMemory(input, source("我喜欢蓝色杯子"))!;
    expect(resolveWenliMemoryMutation(null, source(`@小Q ${body}`), [previous])).toMatchObject({ topicKey: "preference.cup", operation: "forget" });
  });
  it("uses the existing fact slot for an explicit forget despite a missing or drifting model candidate", () => {
    const previous = buildSourcedMemory(input, source("我喜欢蓝色杯子"))!;
    const command = { ...source("@小Q 忘记我的杯子偏好"), id: "1002_forget", clientMessageId: "forget", createdAt: "2026-09-13T00:00:00.000Z" };
    for (const candidate of [null, { ...input, quote: "忘记我的杯子偏好", topicKey: "preference.cup-color", operation: "forget" }]) {
      expect(resolveWenliMemoryMutation(candidate, command, [previous])).toMatchObject({ topicKey: "preference.cup", operation: "forget", status: "retracted" });
    }
    expect(resolveWenliMemoryMutation(null, source("@小Q 忘记我的咖啡偏好"), [previous])).toBeNull();
    expect(resolveWenliMemoryMutation(null, source("@小Q 假如忘记我的杯子偏好"), [previous])).toBeNull();
    expect(resolveWenliMemoryMutation(null, source("@小Q 忘记我的杯子偏好吗？"), [previous])).toBeNull();
    expect(resolveWenliMemoryMutation(null, { ...command, senderId: "1001" }, [previous])).toBeNull();
    const otherCup = { ...previous, id: "other", topicKey: "preference.travel-cup" };
    expect(resolveWenliMemoryMutation(null, command, [previous, otherCup])).toBeNull();
  });
  it("accepts an explicit fact followed by a request to remember, without accepting a guessed question", () => {
    expect(buildSourcedMemory(input, source("@小Q 记住，我喜欢蓝色杯子，好吗？"))).toMatchObject({ subjectId: "1002", summary: "记住，我喜欢蓝色杯子，好吗？" });
    expect(buildSourcedMemory(input, source("@小Q 我喜欢蓝色杯子吗？"))).toBeNull();
    expect(buildSourcedMemory(input, source("@小Q 你猜我喜欢蓝色杯子，对吗？"))).toBeNull();
  });

  it("preserves negation outside a model-selected substring and refuses wrong-subject facts", () => {
    expect(buildSourcedMemory({...input,quote:"喜欢蓝色杯子"},source("@小Q 我不喜欢蓝色杯子"))?.summary).toBe("我不喜欢蓝色杯子");
    expect(buildSourcedMemory({...input,quote:"示例乙喜欢蓝色杯子"},source("@小Q 示例乙喜欢蓝色杯子"))).toBeNull();
    expect(buildSourcedMemory({...input,topicKey:"profile.school"},source("@小Q 我喜欢蓝色杯子"))).toBeNull();
  });
  it("stores a verbatim human statement with subject and stable identity instead of model paraphrase", () => {
    const record = buildSourcedMemory(input, source("@小Q 记住，我喜欢蓝色杯子"));
    expect(record).toMatchObject({summary:"记住，我喜欢蓝色杯子",speakerIds:["1002"],subjectId:"1002",sourceEventIds:["1002_source"],topicKey:"preference.cup"});
    expect(buildSourcedMemory(input, source("@小Q 记住，我喜欢蓝色杯子"))?.id).toBe(record?.id);
  });
  it("rejects hallucinated quotes, ambiguous other-person attribution, secrets and hypothetical claims", () => {
    expect(buildSourcedMemory(input, source("@小Q 你好"))).toBeNull();
    expect(buildSourcedMemory({...input,subjectId:"1001"}, source("@小Q 我喜欢蓝色杯子"))).toBeNull();
    expect(buildSourcedMemory(input, source("@小Q 假设我喜欢蓝色杯子"))).toBeNull();
    expect(buildSourcedMemory({...input,quote:"密码是synthetic-password"}, source("@小Q 密码是synthetic-password"))).toBeNull();
  });
  it("treats a later correction or forget as an atomic replacement event without deleting chat", () => {
    const first = buildSourcedMemory(input, source("@小Q 我喜欢蓝色杯子"))!;
    const nextSource = {...source("@小Q 我不喜欢蓝色杯子"),id:"1002_next",clientMessageId:"next",createdAt:"2026-09-13T00:00:00.000Z"};
    const second = buildSourcedMemory({...input,quote:"我不喜欢蓝色杯子",operation:"correct"},nextSource)!;
    expect(effectiveMemories([first,second]).map(record=>record.id)).toEqual([second.id]);
    const forgotten = buildSourcedMemory({...input,quote:"忘记我的杯子偏好",operation:"forget"},{...nextSource,body:"@小Q 忘记我的杯子偏好",id:"1002_forget",clientMessageId:"forget",createdAt:"2026-09-14T00:00:00.000Z"})!;
    expect(effectiveMemories([first,second,forgotten])).toEqual([]);
  });
});
