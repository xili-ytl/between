/**
 * 同话题检索证据的复用（本地、有界、不进生产数据）。
 *
 * 为什么需要：两阶段设计里，生成阶段的请求是重建的 —— 检索结果只活在当次请求内。
 * 下一轮主人问「第二条详细说说」时，上一轮的搜索结果已经不在上下文里，模型无从解析指代，
 * 于是返回不合规内容并反复失败。Claude Code 的做法是把工具结果留在 mutableMessages 里
 * 继续参与后续轮次（见 QueryEngine.ts:775 / toolResultStorage.ts），这里做等价的本地保留。
 *
 * 边界：
 * - 只按「同一发问者 + 同一话题指纹」复用，话题变了立即失效（避免拿旧证据答新问题）。
 * - 只在很短的指代式追问（如「第二条详细说说」「刚才那个再讲讲」）才复用，
 *   正常提问仍然走完整的检索阶段，不改变原有行为。
 * - 有条数上限与 TTL，进程内存持有，不落盘、不外发。
 */
import type { WenliWebSource } from "../adapters/deepseek-web-search.js";

export interface WenliEvidenceEntry {
  requesterId: string;
  topicFingerprint: string;
  sources: WenliWebSource[];
  evidence: string[];
  expiresAt: number;
}

export interface WenliEvidenceCarryover {
  remember(entry: { requesterId: string; topicFingerprint: string; sources: WenliWebSource[]; evidence: string[] }): void;
  recall(requesterId: string, topicFingerprint: string): { sources: WenliWebSource[]; evidence: string[] } | null;
  size(): number;
}

/** 指代式追问：没有新话题信息，只是在指上一轮说过的内容。 */
export function isReferentialFollowUp(question: string): boolean {
  const text = question.replace(/@小Q/gu, "").trim();
  if (text.length === 0 || [...text].length > 30) return false;
  return /^(?:那|这)[么样]?|第[一二三四五六七八九十\d]+(?:条|点|个|项|篇|张)?|刚才|上面|上面那|前面那|继续|接着|详细说说|展开说说|再多讲讲|再讲讲/u.test(text);
}

export function createWenliEvidenceCarryover(options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}): WenliEvidenceCarryover {
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 8;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, WenliEvidenceEntry>();

  const keyOf = (requesterId: string, fingerprint: string): string => `${requesterId}\u0000${fingerprint}`;

  function evictExpired(): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now()) entries.delete(key);
    }
  }

  return {
    remember(entry) {
      evictExpired();
      if (entry.evidence.length === 0) return;
      entries.delete(keyOf(entry.requesterId, entry.topicFingerprint));
      entries.set(keyOf(entry.requesterId, entry.topicFingerprint), {
        ...entry,
        expiresAt: now() + ttlMs
      });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    recall(requesterId, topicFingerprint) {
      evictExpired();
      const entry = entries.get(keyOf(requesterId, topicFingerprint));
      if (!entry) return null;
      return { sources: entry.sources, evidence: entry.evidence };
    },
    size() {
      evictExpired();
      return entries.size;
    }
  };
}
