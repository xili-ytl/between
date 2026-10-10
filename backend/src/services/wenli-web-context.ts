import type { WenliWebSearchResult, WenliWebSource } from "../adapters/deepseek-web-search.js";
import { timeWenliStage, type WenliTimingContext } from "../domain/wenli-timing.js";
export interface WenliWebSearch { search(query: string, signal: AbortSignal): Promise<WenliWebSearchResult>; }

/** Select an explicitly public clause; never concatenate history or a personal profile. */
export function publicSearchQuery(input: string): string | null {
  const text = input.replace(/@小Q/gu," ").trim();
  if (/^(你|小Q).*(能不能|能|可以|会).*(联网|上网|搜索)[吗么嘛呀呢?？]*$/u.test(text)) return null;
  if (/^(今天|今日)(都)?发生(了)?什么(事)?(了)?[吗呀呢?？]*$/u.test(text)) return null;
  const clauses = text.split(/[，,。；;\n]/u).map(clause => clause.trim().replace(/^(请|麻烦)?(帮我|替我|给我|我想知道|我想了解|我想要|我想)/u,""));
  for (const clause of clauses.reverse()) {
    // Algorithm names contain search verbs without requesting a web lookup.
    const intent = clause.replace(/(?:二分|二叉|顺序|插值)查找|(?:二分|深度优先|广度优先)搜索/gu, "");
    const subject = clause.replace(/搜索|搜一下|搜搜|查一下|查查|查找|查资料|联网|并|给出|给|附上|提供|来源|原文|链接|一下|请/gu, "").trim();
    if ([...subject].length < 2) continue;
    if (!/(搜索|^搜|搜一下|搜搜|查一下|查查|查找|查资料|联网|帮忙查)/u.test(intent) && !(/今天|今日|最新|最近|实时/u.test(intent) && /新闻|消息|版本|发布|进展|价格|天气|论文|活动|AI|大模型|科技|电影|政策|发生|有哪些/iu.test(intent))) continue;
    if (/我|咱|你们|我们|他们|她|他|示例甲|示例乙|1001|1002|密码|口令|密钥|验证码|token|api.?key|private.?key|[\w.+-]+@[\w.-]+\.[a-z]+|\b1\d{10}\b|[\u0000-\u001f]/iu.test(clause)) continue;
    if ([...clause].length > 400) continue;
    return clause;
  }
  return null;
}

export function isWebFollowUp(input: string): boolean {
  return /第[一二三四五六七八九十\d]+[条个项]|刚才.*(新闻|来源|链接|搜索)|来源呢|详细说说|展开说说|原文链接/u.test(input);
}

export async function prepareWenliWebContext(input: string, search: WenliWebSearch | undefined, signal: AbortSignal, recentPublicRequests: readonly string[] = [], timing?: WenliTimingContext): Promise<{text:string;sources:WenliWebSource[];fallbackReply?:string}> {
  // History is only scanned locally. Only a fresh, minimized public query crosses the search boundary.
  const query = publicSearchQuery(input) ?? (isWebFollowUp(input) ? [...recentPublicRequests].reverse().map(publicSearchQuery).find(value => value !== null) ?? null : null);
  if (!query) return {text:JSON.stringify({web:search ? "available_not_used" : "unavailable", searched:false}),sources:[]};
  if (!search) return {text:JSON.stringify({web:"unavailable",searched:false}),sources:[],fallbackReply:"这次搜索暂时不可用，我还不能确认最新消息呀 >_<"};
  try {
    const result = await timeWenliStage(timing, "public_search", () => search.search(query,signal), () => ({ requestCount: 1 }));
    return {text:result.text,sources:result.sources,...(result.sources.length ? {} : {fallbackReply:"这次没有搜到可用的来源，还不能确定呢 >_<"})};
  } catch {
    if (signal.aborted) { const error = new Error("Wenli request aborted"); error.name="AbortError"; throw error; }
    return {text:JSON.stringify({web:"failed",searched:false}),sources:[],fallbackReply:"这次没能查到可靠的结果，暂时不能确认最新消息呀 >_<"};
  }
}

export function withVerifiedSources(reply: string, sources: readonly WenliWebSource[], strict = false): string {
  if (!sources.length && !strict) return reply;
  const allowed = new Set(sources.map(source=>source.url));
  const cleaned = reply.replace(/https?:\/\/[^\s<>\])）。，、；！？“”]+/gu, url => allowed.has(url) ? url : "[链接未核实]");
  return cleaned;
}
