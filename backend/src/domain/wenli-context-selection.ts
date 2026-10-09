import type { WenliMemoryRecord } from "./wenli-memory.js";
import type { WenliBackgroundFact } from "./wenli-persona-source.js";
import { effectiveMemories } from "./wenli-memory-candidate.js";

const TOPICS: ReadonlyArray<[WenliBackgroundFact["topic"], RegExp]> = [
  ["origin", /为什么叫问理|名字.*(来|取|起)|名字的含义|复活|回来|童年|起源|一起养|企鹅.*(过去|故事)|Q\s*宠|亚托莉/iu],
  ["birthday", /生日|哪天出生|出生日期|几岁|多大了/u],
  ["school", /学校|大学|专业|年级|大[一二三四]|高[一二三]|读几年|在哪.*(读|学)|学段/u],
  ["competition", /ACM|ICPC|蓝桥|比赛|竞赛|奖项|获奖|省金|国一/iu],
  ["future-study", /考研|硕士|中科大|研究方向|升学计划/u],
  ["health", /养病|病情|休学|复学|治疗|抑郁/u],
  ["preference", /喜欢|偏好|习惯/u]
];

export function selectWenliBackground(query: string, speaker: "1002" | "1001", facts: readonly WenliBackgroundFact[]): WenliBackgroundFact[] {
  const subjects = new Set<string>();
  if (query.includes("示例甲")) subjects.add("1002");
  if (query.includes("示例乙")) subjects.add("1001");
  if (/我们|两位|两人|各自/u.test(query)) { subjects.add("1002"); subjects.add("1001"); }
  if (subjects.size === 0) subjects.add(speaker);
  const topics = new Set(TOPICS.filter(([, pattern]) => pattern.test(query)).map(([topic]) => topic));
  const selected = facts.filter(fact => topics.has(fact.topic) && (fact.subject === "couple" || fact.subject === "wenli" || subjects.has(fact.subject)) && (!fact.sensitive || topics.has("health")));
  return selected.slice(0, topics.has("origin") ? 8 : 4);
}

export function selectWenliMemories(query: string, records: readonly WenliMemoryRecord[], now: string, limit = 4, speaker?: "1002" | "1001"): WenliMemoryRecord[] {
  const terms = keywords(query);
  if (terms.size === 0 || isSimpleExchange(query)) return [];
  const sensitiveContext = TOPICS.find(([topic]) => topic === "health")![1].test(query);
  const subjects = new Set<string>();
  if (query.includes("示例甲")) subjects.add("1002");
  if (query.includes("示例乙")) subjects.add("1001");
  if (/我们|两位|两人|各自/u.test(query)) { subjects.add("1002"); subjects.add("1001"); }
  if (!subjects.size && speaker) subjects.add(speaker);
  const topics = new Set(TOPICS.filter(([,pattern]) => pattern.test(query)).map(([topic]) => `profile.${topic}`));
  return effectiveMemories(records.filter(record => (!record.validFrom || record.validFrom <= now) && (!record.validTo || record.validTo > now)))
    .filter(record => !subjects.size || !record.subjectId || subjects.has(record.subjectId))
    .filter(record => record.sourceEventIds.length > 0 && record.speakerIds.some(id => id === "1002" || id === "1001"))
    .filter(record => sensitiveContext || (!record.sensitive && !/抑郁|病情|用药|诊断|养病|休学|治疗/u.test(record.summary)))
    .filter(record => [...record.summary].length <= 512)
    .map(record => ({ record, score: overlap(terms, keywords(record.summary)) + (record.topicKey && topics.has(record.topicKey) ? 3 : 0) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt) || b.record.id.localeCompare(a.record.id))
    .slice(0, Math.max(0, Math.min(limit, 8))).map(entry => entry.record);
}

export function isSimpleExchange(query: string): boolean {
  const text = query.replace(/@问理/gu, "").trim().replace(/[，。！？!?~～\s]/gu, "");
  return /^(你好(呀|啊)?|嗨|hello|hi|在吗|qwq|QwQ|谢谢|谢啦|你是谁(呀)?|我是谁(呀)?|你是男生还是女生|我是男生还是女生)$/iu.test(text);
}

function keywords(text: string): Set<string> {
  const result = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z0-9]{2,}|[\p{Script=Han}]+/gu) ?? []) {
    if (/^[a-z0-9]+$/u.test(word)) result.add(word);
    else for (let index = 0; index < word.length - 1; index++) {
      const pair = word.slice(index, index + 2);
      if (!/^(问理|主人|一下|这个|那个|可以|什么|记得|我们|你们|喜欢|不思|思问|示例甲)$/u.test(pair)) result.add(pair);
    }
  }
  return result;
}
function overlap(left: Set<string>, right: Set<string>): number { return [...left].filter(term => right.has(term)).length; }
