import { describe, expect, it } from "vitest";
import { createWenliEvidenceCarryover, isReferentialFollowUp } from "../src/services/wenli-evidence-carryover.js";

const source = (url: string) => ({ url, title: "t" });

describe("Wenli evidence carryover", () => {
  it("recognizes referential follow-ups and leaves real questions alone", () => {
    for (const followUp of ["第二条详细说说", "刚才那个再讲讲", "继续", "那第一条呢", "上面那个展开说说"]) {
      expect(isReferentialFollowUp(followUp)).toBe(true);
    }
    for (const real of ["今天有什么 AI 新闻", "帮我查一下 DeepSeek 公告", "你好呀", "你是谁"]) {
      expect(isReferentialFollowUp(real)).toBe(false);
    }
  });

  it("carries the previous search evidence for the same topic and requester", () => {
    const carry = createWenliEvidenceCarryover();
    carry.remember({ requesterId: "1002", topicFingerprint: "topic-a", sources: [source("https://a")], evidence: ["evidence-a"] });
    expect(carry.recall("1002", "topic-a")).toEqual({ sources: [source("https://a")], evidence: ["evidence-a"] });
    // 另一位主人不能拿到同一份证据
    expect(carry.recall("1001", "topic-a")).toBeNull();
    // 话题变了就不复用
    expect(carry.recall("1002", "topic-b")).toBeNull();
  });

  it("ignores empty evidence and expires entries", () => {
    let clock = 1_000;
    const carry = createWenliEvidenceCarryover({ ttlMs: 5_000, now: () => clock });
    carry.remember({ requesterId: "1002", topicFingerprint: "t", sources: [], evidence: [] });
    expect(carry.size()).toBe(0);
    carry.remember({ requesterId: "1002", topicFingerprint: "t", sources: [source("https://a")], evidence: ["e"] });
    clock += 4_999;
    expect(carry.recall("1002", "t")).not.toBeNull();
    clock += 2;
    expect(carry.recall("1002", "t")).toBeNull();
  });

  it("bounds how many topics it keeps", () => {
    const carry = createWenliEvidenceCarryover({ maxEntries: 2 });
    for (const topic of ["a", "b", "c"]) {
      carry.remember({ requesterId: "1002", topicFingerprint: topic, sources: [source(`https://${topic}`)], evidence: [topic] });
    }
    expect(carry.size()).toBe(2);
    expect(carry.recall("1002", "a")).toBeNull();
    expect(carry.recall("1002", "c")).not.toBeNull();
  });
});
