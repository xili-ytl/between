import { createHash } from "node:crypto";
import type { MessageRecord } from "./contracts.js";
import { parseWenliMemoryRecord, type WenliMemoryRecord } from "./wenli-memory.js";

/** Only verified source text is retained; model-written summaries are never evidence. */
export function buildSourcedMemory(value: unknown, source: MessageRecord): WenliMemoryRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || (source.senderId !== "1002" && source.senderId !== "1001") || source.relationshipId !== "couple") return null;
  const candidate = value as Record<string, unknown>;
  const { quote, subjectId, topicKey, kind, operation } = candidate;
  if (typeof quote !== "string" || [...quote].length < 3 || [...quote].length > 300 || !source.body.includes(quote)) return null;
  // Remove only the mention token; preserve the surrounding human wording
  // when the token was inserted in the middle of a draft.
  const statement = source.body.replace(/(^|[\s，,：:])@小Q(?=$|[\s，,：:])/gu, "$1").trim();
  if ([...statement].length > 512) return null;
  const asserted = /记住|记一下|记着|记忆/u.test(statement)
    ? statement.replace(/[,，。]\s*(?:好吗|可以吗|能记住吗|能记一下吗|记住了吗)[?？]+\s*$/u, "")
    : statement;
  if (/假设|假如|比如|引用|转述|角色扮演|你猜|[?？]/u.test(asserted) || /密码|口令|密钥|验证码|token|api.?key|private.?key/iu.test(statement)) return null;
  if (subjectId !== "1002" && subjectId !== "1001") return null;
  if (subjectId !== source.senderId && !quote.includes(subjectId === "1002" ? "示例甲" : "示例乙")) return null;
  if (subjectId === source.senderId && statement.includes(subjectId === "1002" ? "示例乙" : "示例甲")) return null;
  if (typeof topicKey !== "string" || /identity|gender|name|account/iu.test(topicKey)) return null;
  const profileTopics: Record<string, RegExp> = {
    "profile.school": /学校|大学|专业|年级|大[一二三四]|高[一二三]|学段|入学|上学|就读/u,
    "profile.birthday": /生日|出生/u,
    "profile.competition": /ACM|ICPC|蓝桥|比赛|竞赛|奖项|获奖/iu,
    "profile.future-study": /考研|硕士|研究方向|升学/u,
    "profile.health": /病|治疗|休学|复学|抑郁|用药|诊断/u
  };
  if (topicKey.startsWith("profile.") && !profileTopics[topicKey]?.test(statement)) return null;
  if (operation === "forget" && (subjectId !== source.senderId || forgetTarget(statement, source.senderId) === null)) return null;
  try {
    return parseWenliMemoryRecord({
      id: `mem_${createHash("sha256").update(`${source.id}:${subjectId}:${topicKey}`).digest("hex").slice(0, 32)}`,
      kind, summary: statement, subjectId, topicKey, operation,
      sensitive: /抑郁|病情|用药|诊断|养病|休学|治疗/u.test(statement),
      speakerIds: [source.senderId], sourceEventIds: [source.id], salience: 50,
      status: operation === "forget" ? "retracted" : "active", createdAt: source.createdAt, updatedAt: source.createdAt
    });
  } catch { return null; }
}

/** An explicit, unambiguous owner command does not depend on the model remembering to emit JSON. */
export function resolveWenliMemoryMutation(value: unknown, source: MessageRecord, records: readonly WenliMemoryRecord[]): WenliMemoryRecord | null {
  const statement = source.body.replace(/@小Q/gu, "").trim();
  if (source.senderId !== "1002" && source.senderId !== "1001") return null;
  const target = forgetTarget(statement, source.senderId);
  if (target === null) return buildSourcedMemory(value, source);
  const terms = mutationTerms(target);
  if (terms.size === 0) return null;
  const matching = effectiveMemories(records.filter(record => record.updatedAt <= source.createdAt)).filter(record => {
    const knownTerms = mutationTerms(record.summary);
    return record.subjectId === source.senderId && record.topicKey && [...terms].every(term => knownTerms.has(term));
  });
  // Several cup-related slots need clarification; never erase another person or unrelated preference.
  if (matching.length !== 1) return null;
  const previous = matching[0]!;
  return buildSourcedMemory({ quote: statement, subjectId: source.senderId, topicKey: previous.topicKey, kind: previous.kind, operation: "forget" }, source);
}

/** Conservative imperative grammar shared by model candidates and deterministic mutations. */
function forgetTarget(statement: string, senderId: "1002" | "1001"): string | null {
  const command = /^(?:请)?(?:忘记|别再记|不要再记|删除)\s*(我|示例甲|示例乙)(?:的)?(.+)$/u.exec(statement);
  if (!command || (command[1] !== "我" && command[1] !== (senderId === "1002" ? "示例甲" : "示例乙"))) return null;
  const target = command[2]!.replace(/[,，]\s*(?:谢谢|多谢|拜托)[。！!\s]*$/u, "").replace(/[。！!\s]+$/u, "").replace(/[吧啦呀哦]$/u, "").trim();
  // Questions, assertions, conditional clauses and several targets need clarification.
  if (!target || /[?？，,；;：:“”「」『』"'、]|吗|么|嘛|是否|是不是|能不能|可不可以|好不好|不可以|不能|不是|不该|不应|不想|不愿|不允许|不希望|假设|假如|如果|的话|怎样|怎么|为什么|可以|应该|需要|以及|还有|或者|和|与|及|但|而|是/u.test(target)) return null;
  return target;
}

function mutationTerms(text: string): Set<string> {
  const terms = new Set<string>();
  const content = text.toLowerCase().replace(/小Q|主人|示例甲|示例乙|记住|记一下|忘记|别再记|不要再记|删除|纠正一下|纠正|我的|我现在|我喜欢|我不喜欢|喜欢|关于|现在|那条|这条|偏好|记忆|好吗|可以吗/gu, " ");
  for (const word of content.match(/[a-z0-9]{3,}|[\p{Script=Han}]{2,}/gu) ?? []) {
    if (/^[a-z0-9]+$/u.test(word)) terms.add(word);
    else for (let index = 0; index < word.length - 1; index++) terms.add(word.slice(index, index + 2));
  }
  return terms;
}

/** Omit superseded source events from the model context; the underlying chat stays intact. */
export function supersededMemorySources(records: readonly WenliMemoryRecord[], now: string): Set<string> {
  const ids = new Set<string>();
  const latest = new Map<string, WenliMemoryRecord>();
  const eligible = [...records].filter(record => record.updatedAt <= now).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  for (const record of eligible) {
    if (!record.subjectId || !record.topicKey) continue;
    const slot = `${record.subjectId}:${record.topicKey}`;
    const current = latest.get(slot);
    if (!current) latest.set(slot, record);
    else if (current.operation === "correct" || current.operation === "forget") for (const id of record.sourceEventIds) ids.add(id);
  }
  return ids;
}

/** Append-only replacement event: the new record atomically shadows the old slot. */
export function effectiveMemories(records: readonly WenliMemoryRecord[]): WenliMemoryRecord[] {
  const seen = new Set<string>();
  const result: WenliMemoryRecord[] = [];
  for (const record of [...records].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))) {
    if (record.subjectId && record.topicKey) {
      const slot = `${record.subjectId}:${record.topicKey}`;
      if (seen.has(slot)) continue;
      seen.add(slot);
    }
    if (record.status === "active") result.push(record);
  }
  return result;
}
