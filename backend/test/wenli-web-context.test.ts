import { describe, expect, it, vi } from "vitest";
import { publicSearchQuery, prepareWenliWebContext, withVerifiedSources } from "../src/services/wenli-web-context.js";
describe("public query boundary", () => {
  it("does not search a capability question or an ambiguous day recap", async () => {
    const search=vi.fn(async()=>({searched:true as const,text:"irrelevant",sources:[]}));
    for(const input of ["@小Q 你能联网么","你可以联网嘛？","小Q能不能上网呀","你会搜索吗","今天发生什么事了","今天发生了什么事？"]){
      const result=await prepareWenliWebContext(input,{search},new AbortController().signal,["查一下今天AI新闻"]);
      expect(result.sources).toEqual([]);
      expect(result.fallbackReply).toBeUndefined();
    }
    expect(search).not.toHaveBeenCalled();
    expect(publicSearchQuery("今天AI圈发生什么事了")).toBe("今天AI圈发生什么事了");
    expect(publicSearchQuery("帮我搜索联网失败的原因")).not.toBeNull();
  });
  it("does not append unused sources when the reply says results are irrelevant", () => {
    expect(withVerifiedSources("没有查到相关结果呢",[{title:"无关网页",url:"https://example.com/unrelated"}])).toBe("没有查到相关结果呢");
    expect(withVerifiedSources("看看 https://invented.example.com",[{title:"文档",url:"https://example.com/doc"}])).not.toContain("https://invented.example.com");
    expect(withVerifiedSources("来源 https://example.com/doc",[{title:"文档",url:"https://example.com/doc"}])).toContain("https://example.com/doc");
    expect(withVerifiedSources("来源 https://example.com/doc。",[{title:"文档",url:"https://example.com/doc"}])).toBe("来源 https://example.com/doc。");
  });
  it("understands common public search requests without forwarding personal lead-ins", () => {
    expect(publicSearchQuery("我想知道今天AI圈发生了什么")).toBe("今天AI圈发生了什么");
    expect(publicSearchQuery("帮我搜DeepSeek最新公告")).toBe("搜DeepSeek最新公告");
    expect(publicSearchQuery("我想查一下 Claude Opus 4.6 最新公告")).toBe("查一下 Claude Opus 4.6 最新公告");
    expect(publicSearchQuery("今天AI圈有哪些新闻，查一下并给来源")).toBe("今天AI圈有哪些新闻");
  });
  it("re-searches a prior public question for follow-ups and never sends private history", async () => {
    const search = vi.fn(async () => ({searched:true as const,text:"results",sources:[]}));
    const signal = new AbortController().signal;
    await prepareWenliWebContext("第二条详细说说", {search},signal,["我在合成学校", "帮我查一下今天AI新闻"]);
    expect(search).toHaveBeenCalledWith("查一下今天AI新闻",signal);
    search.mockClear();
    await prepareWenliWebContext("刚才那条公告详细说说", {search},signal,["帮我查一下DeepSeek最新公告"]);
    expect(search).toHaveBeenCalledWith("查一下DeepSeek最新公告",signal);
    search.mockClear();
    await prepareWenliWebContext("第二条详细说说", {search},signal,["我的私人故事"]);
    expect(search).not.toHaveBeenCalled();
  });
  it("searches explicit and current public questions without fetching on greetings or private stories", () => {
    expect(publicSearchQuery("@小Q 今天AI圈发生了哪些事")).toBe("今天AI圈发生了哪些事");
    expect(publicSearchQuery("@小Q 帮我查一下矩阵快速幂的资料")).toBe("查一下矩阵快速幂的资料");
    expect(publicSearchQuery("@小Q 你好")).toBeNull();
    expect(publicSearchQuery("小Q为什么叫小Q")).toBeNull();
  });
  it("never forwards private clauses, owner names, email, credentials or health context", () => {
    expect(publicSearchQuery("我在合成学校读书，帮我查一下今天AI新闻")).toBe("查一下今天AI新闻");
    for (const query of ["查一下示例甲的资料", "查一下我的休学情况", "搜一下我的密码synthetic", "查一下foo@example.com"]) expect(publicSearchQuery(query)).toBeNull();
  });
  it("only sends the minimized query and exposes actual success or a bounded failure", async () => {
    const search = vi.fn(async () => ({searched:true as const,text:"public results",sources:[{url:"https://example.com/announcement",title:"公告"}]}));
    const signal = new AbortController().signal;
    expect((await prepareWenliWebContext("我在合成学校读书，帮我查一下今天AI新闻", {search}, signal)).sources).toHaveLength(1);
    expect(search).toHaveBeenCalledWith("查一下今天AI新闻", signal);
    const failed = await prepareWenliWebContext("今天AI新闻",{search:vi.fn(async()=>{throw new Error("secret provider response")})},signal);
    expect(failed.text).toContain("failed");
    expect(failed.text).not.toContain("secret provider response");
    expect(failed.fallbackReply).toBe("这次没能查到可靠的结果，暂时不能确认最新消息呀 >_<");
  });
});
