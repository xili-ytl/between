import type { AccountId, MessageRecord, MomentCommentRecord, MomentRecord } from "../domain/contracts.js";
import type { MomentStore } from "../ports/stores.js";

const MAX_SCAN = 100;
const MAX_SELECTED = 4;
const MAX_CONTEXT_POINTS = 5200;
const MAX_COMMENTS = 8;
const FOLLOW_UP_MAX_AGE_MS = 15 * 60 * 1000;
const COMMENT_INTENT = /评论|留言/u;
const MOMENT_INTENT = /朋友圈|(?:我们|你们|我|示例甲|示例乙)(?:刚|最近|之前)?发(?:过|的|了)?(?:那条|这条)?动态|(?:这条|那条|最新的|最近的)动态|动态(?:里|中|内容|照片)|那条(帖子|照片|图片)|发的(帖子|照片|图片)/u;
const IMAGE_INTENT = /图|照片|图片|拍的|画面|看见|看到/iu;
export function isMomentQuery(query: string): boolean { return MOMENT_INTENT.test(query); }
const STOP_PAIRS = new Set(["问理", "主人", "我们", "你们", "他们", "什么", "怎么", "那个", "这条", "之前", "动态", "朋友", "友圈", "图片", "照片", "发的", "看到", "能看", "一下", "了吗", "里面", "请问"]);

export interface WenliMomentContext {
  status: "not_requested" | "found" | "empty" | "unavailable";
  posts: MomentRecord[];
  scanned: number;
  scanLimit: number;
  imageRequested: boolean;
  comments?: MomentCommentRecord[];
  commentsStatus?: "not_requested" | "found" | "empty" | "unavailable";
}

export interface WenliMomentContextProvider {
  select(query: string, signal: AbortSignal): Promise<WenliMomentContext>;
}

/** Shared chat may only receive posts that both owners were allowed to see. */
export class StoreWenliMomentContextProvider implements WenliMomentContextProvider {
  constructor(private readonly store: Pick<MomentStore, "latestVisibleMoments"> & Partial<Pick<MomentStore, "commentsForContext">>) {}

  async select(query: string, signal: AbortSignal): Promise<WenliMomentContext> {
    if (!isMomentQuery(query)) return { status: "not_requested", posts: [], scanned: 0, scanLimit: MAX_SCAN, imageRequested: false };
    if (signal.aborted) throw abortError();
    const imageRequested = IMAGE_INTENT.test(query);
    try {
      // Either owner is sufficient for PARTNER posts; SELF rows are filtered again below.
      const rows = await this.store.latestVisibleMoments("1002", MAX_SCAN);
      if (signal.aborted) throw abortError();
      const eligible = rows.filter(isSharedMoment);
      const terms = termsFor(query);
      const ranked = eligible.map((post, index) => ({ post, index, score: score(post, terms, query) }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
      const selected = (terms.length && ranked.some(item => item.score > 0)
        ? ranked.filter(item => item.score > 0)
        : ranked).slice(0, MAX_SELECTED);
      let points = 0;
      const posts: MomentRecord[] = [];
      for (const { post } of selected) {
        const cost = [...JSON.stringify({ id: post.id, authorId: post.authorId, createdAt: post.createdAt, body: post.body })].length;
        if (points + cost > MAX_CONTEXT_POINTS) continue;
        posts.push(post);
        points += cost;
      }
      const comments: MomentCommentRecord[] = [];
      let commentsStatus: NonNullable<WenliMomentContext["commentsStatus"]> = "not_requested";
      if (posts.length && COMMENT_INTENT.test(query)) {
        commentsStatus = "unavailable";
        if (this.store.commentsForContext) try {
          const postIds = posts.map(post => post.id);
          const rows = await this.store.commentsForContext(postIds, MAX_COMMENTS);
          if (signal.aborted) throw abortError();
          for (const comment of rows) {
            if (comments.length >= MAX_COMMENTS) break;
            if (!postIds.includes(comment.momentId) || (comment.authorId !== "1002" && comment.authorId !== "1001") ||
                comment.id !== `${comment.authorId}_${comment.clientCommentId}` || typeof comment.body !== "string") continue;
            const cost = [...JSON.stringify(comment)].length;
            if (points + cost > MAX_CONTEXT_POINTS) continue;
            points += cost;
            comments.push(comment);
          }
          commentsStatus = comments.length ? "found" : "empty";
        } catch {
          if (signal.aborted) throw abortError();
        }
      }
      return { status: posts.length ? "found" : "empty", posts, scanned: rows.length, scanLimit: MAX_SCAN, imageRequested, comments, commentsStatus };
    } catch (error) {
      if (signal.aborted) throw abortError();
      return { status: "unavailable", posts: [], scanned: 0, scanLimit: MAX_SCAN, imageRequested };
    }
  }
}

/** Carry a recent human topic, never a model-invented post or a stale session hint. */
export function resolveWenliMomentQuery(source: MessageRecord, history: readonly MessageRecord[], quote: MessageRecord | null): string {
  const query = source.body;
  if (isMomentQuery(query)) return query;
  const cleaned = query.replace(/@问理/gu, "").trim();
  if ([...cleaned].length > 100 || !/^(那|这|它|她|他|里面|上面|后来|然后|再|继续|详细|还有|能看清|是什么颜色)/u.test(cleaned)) return query;
  if (/换个话题|不说这个|先不聊|联网|搜一下|查一下|新闻|教程|代码|算法/u.test(cleaned)) return query;
  if (quote && quote.senderId !== "wenli" && isMomentQuery(quote.body)) return `${quote.body}\n追问：${query}`;
  const now = Date.parse(source.createdAt);
  for (const message of history.slice(-6).reverse()) {
    if (message.senderId === "wenli") continue;
    const age = now - Date.parse(message.createdAt);
    if (!Number.isFinite(age) || age < 0 || age > FOLLOW_UP_MAX_AGE_MS) return query;
    if (isMomentQuery(message.body)) return `${message.body}\n追问：${query}`;
    if (!/^(那|这|它|她|他|里面|上面|后来|然后|再|继续|详细|还有)/u.test(message.body.replace(/@问理/gu, "").trim())) return query;
  }
  return query;
}

export function isSharedMoment(post: MomentRecord): boolean {
  return !post.deleting && post.visibility === "PARTNER" &&
    (post.authorId === "1002" || post.authorId === "1001") &&
    post.id === `${post.authorId}_${post.clientMomentId}` && typeof post.body === "string";
}

function termsFor(query: string): string[] {
  const cleaned = query.replace(/@问理|朋友圈|动态/gu, "").toLowerCase();
  const result = new Set<string>();
  for (const word of cleaned.match(/[a-z0-9]{3,}|[\p{Script=Han}]+/gu) ?? []) {
    if (/^[a-z0-9]+$/u.test(word)) result.add(word);
    else for (let i = 0; i < word.length - 1; i++) {
      const pair = word.slice(i, i + 2);
      if (!STOP_PAIRS.has(pair)) result.add(pair);
    }
  }
  return [...result];
}

function score(post: MomentRecord, terms: string[], query: string): number {
  const body = post.body.toLowerCase();
  let value = terms.filter(term => body.includes(term)).length;
  if (query.includes("示例甲") && post.authorId === "1002") value += 2;
  if (query.includes("示例乙") && post.authorId === "1001") value += 2;
  return value;
}

function abortError(): Error { const error = new Error("Wenli moment context aborted"); error.name = "AbortError"; return error; }
