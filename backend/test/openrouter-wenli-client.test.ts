import { describe, expect, it, vi } from "vitest";
import { HttpOpenRouterWenliClient, HttpOpenRouterPublicSearch } from "../src/adapters/openrouter-wenli-client.js";
import type { WenliTimingEvent } from "../src/domain/wenli-timing.js";
const signal = () => new AbortController().signal;
const answer = (reply = "可以查公开资料呀 >_<") => ({choices:[{message:{role:"assistant",content:JSON.stringify({reply,memoryUpdate:null})},finish_reason:"stop"}]});
const call = (query:string) => ({choices:[{message:{role:"assistant",content:null,tool_calls:[{id:"search-1",type:"function",function:{name:"search_public_web",arguments:JSON.stringify({query})}}]},finish_reason:"tool_calls"}]});
const prose = (text:string) => ({choices:[{message:{role:"assistant",content:text},finish_reason:"stop"}]});
function transport(results:unknown[]) { return vi.fn(async()=>new Response(JSON.stringify(results.shift()),{status:200})); }
function bodyOf(fetchFn:ReturnType<typeof vi.fn>, index:number) {
  return JSON.parse((fetchFn.mock.calls as unknown as [string,RequestInit][])[index]![1].body as string);
}

/**
 * 两阶段契约（成熟 tool-calling 架构）：
 * - 检索阶段：带 tools、**不带**结构化输出，由模型决定是否检索
 * - 生成阶段：全新请求，**不带 tools、不带 tool 结果**，强制 JSON 并自行校验（失败重试一次）
 * 之前把两者混在同一轮，导致模型在收尾轮继续要求调工具或回散文，回复整次作废。
 */
describe("MiMo Wenli two-phase search and reply",()=>{
  it("does not mistake a public domain fragment for private memory",async()=>{
    const fetchFn=transport([call("MiMo 官方介绍 site:mi.com 2026"),answer()]);
    const search=vi.fn(async()=>({searched:true as const,text:"official",sources:[]}));
    await new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search}).complete([{role:"user",content:"查介绍"}],signal(),{privateSearchTexts:["2026 年喜欢 Microsoft 的某个产品"]});
    expect(search).toHaveBeenCalledOnce();
  });
  it("accepts MiMo's textual tool envelope through the same private-query checks",async()=>{
    const decision={choices:[{message:{content:'```json\n{"tool":"search_public_web","args":{"query":"小米 MiMo 官方介绍"}}\n```'},finish_reason:"stop"}]};
    const fetchFn=transport([decision,answer()]);
    const search=vi.fn(async()=>({searched:true as const,text:"official",sources:[]}));
    await new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search}).complete([{role:"user",content:"查介绍"}],signal());
    expect(search).toHaveBeenCalledOnce();
  });
  it("executes a promised search instead of returning a progress-only answer",async()=>{
    const fetchFn=transport([answer("好呀，我帮你搜一下~"),call("小米 MiMo 官方介绍"),answer("查到了，官方介绍支持多模态。")]);
    const search=vi.fn(async()=>({searched:true as const,text:"Official multimodal introduction",sources:[{url:"https://mimo.mi.com/",title:"MiMo"}]}));
    await new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search}).complete([{role:"user",content:"查一下小米 MiMo 官方介绍"}],signal());
    expect(search).toHaveBeenCalledOnce();
  });
  it("answers without searching when the model declines the tool",async()=>{
    // 两阶段设计：检索阶段一次请求（不调工具）+ 生成阶段一次请求
    const fetchFn=transport([answer(),answer()]); const search=vi.fn();
    const client=new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search});
    expect(await client.complete([{role:"user",content:"你能联网么"}],signal())).toContain("可以查公开资料");
    expect(search).not.toHaveBeenCalled();
    const phase1=bodyOf(fetchFn,0);
    expect(phase1.model).toBe("xiaomi/mimo-v2.6-flash");
    expect(phase1.provider).toMatchObject({order:["Xiaomi"],allow_fallbacks:false,data_collection:"deny"});
    expect(phase1.tools).toHaveLength(1);
    expect(phase1.tool_choice).toBe("auto");
    // 检索阶段不得携带结构化输出，两者混用正是原来的故障源
    expect(phase1.response_format).toBeUndefined();
    expect(phase1.reasoning).toEqual({enabled:false});
    // 模型没要求检索：一次检索阶段 + 一次生成阶段 = 2 次，且生成阶段无工具
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchFn,1).tools).toBeUndefined();
    expect(bodyOf(fetchFn,1).response_format).toEqual({type:"json_object"});
  });

  it("keeps the persona as one cacheable prefix while the timestamp stays out of it",async()=>{
    const fetchFn=transport([answer(),answer()]);
    const client=new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search:vi.fn()});
    await client.complete([
      {role:"system",content:"persona block one"},
      {role:"system",content:"persona block two"},
      {role:"user",content:"示例甲主人你好"}
    ],signal());
    const phase1=bodyOf(fetchFn,0);
    const cached=phase1.messages.find((m:any)=>Array.isArray(m.content)&&m.content[0]?.cache_control);
    expect(cached).toBeDefined();
    expect(cached.content[0].text).toContain("persona block one");
    expect(cached.content[0].text).toContain("persona block two");
    // 静态前缀不得含时间戳，否则提供商缓存永远不命中
    expect(cached.content[0].text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(phase1.messages.filter((m:any)=>m!==cached))).toMatch(/\d{4}-\d{2}-\d{2}T/);
    // 生成阶段沿用同一份静态前缀
    const phase2=bodyOf(fetchFn,1);
    const cached2=phase2.messages.find((m:any)=>Array.isArray(m.content)&&m.content[0]?.cache_control);
    expect(cached2.content[0].text).toContain("persona block one");
  });

  it("labels the authoritative Beijing time instead of exposing the UTC hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T14:59:00.000Z"));
    try {
      const fetchFn = transport([answer(), answer()]);
      const client = new HttpOpenRouterWenliClient("synthetic-key", fetchFn, { search: vi.fn() });

      await client.complete([{ role: "user", content: "现在几点" }], signal(), { allowSearch: false });

      expect(JSON.stringify(bodyOf(fetchFn, 0).messages)).toContain("2026-09-14T22:59:00+08:00");
      expect(JSON.stringify(bodyOf(fetchFn, 0).messages)).toContain("UTC reference only: 2026-09-14T14:59:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes the Beijing date when a generation retry crosses midnight", async () => {
    const beforeMidnight = new Date("2026-09-14T15:59:00.000Z");
    const afterMidnight = new Date("2026-09-14T16:00:00.000Z");
    const times = [beforeMidnight, beforeMidnight, afterMidnight];
    let clockIndex = 0;
    const clock = vi.fn(() => times[Math.min(clockIndex++, times.length - 1)]!);
    const fetchFn = transport([answer(), prose("not JSON"), answer("跨日后重新说完整了")]);
    const client = new HttpOpenRouterWenliClient("synthetic-key", fetchFn, { search: vi.fn() }, clock);

    await client.complete([{ role: "user", content: "继续说" }], signal());

    expect(JSON.stringify(bodyOf(fetchFn, 0).messages)).toContain("2026-09-14T23:59:00+08:00");
    expect(JSON.stringify(bodyOf(fetchFn, 1).messages)).toContain("2026-09-14T23:59:00+08:00");
    expect(JSON.stringify(bodyOf(fetchFn, 2).messages)).toContain("2026-09-15T00:00:00+08:00");
  });

  it("refreshes the Beijing date for an internal search-routing retry", async () => {
    const beforeMidnight = new Date("2026-09-14T15:59:00.000Z");
    const afterMidnight = new Date("2026-09-14T16:00:00.000Z");
    const times = [beforeMidnight, afterMidnight, afterMidnight];
    let clockIndex = 0;
    const clock = vi.fn(() => times[Math.min(clockIndex++, times.length - 1)]!);
    const fetchFn = transport([prose("我这就搜一下"), call("公开话题"), answer("查到了")]);
    const search = vi.fn(async () => ({ searched: true as const, text: "evidence", sources: [] }));
    const client = new HttpOpenRouterWenliClient("synthetic-key", fetchFn, { search }, clock);

    await client.complete([{ role: "user", content: "查一下公开话题" }], signal());

    expect(JSON.stringify(bodyOf(fetchFn, 0).messages)).toContain("2026-09-14T23:59:00+08:00");
    expect(JSON.stringify(bodyOf(fetchFn, 1).messages)).toContain("2026-09-15T00:00:00+08:00");
  });

  it("executes the model's query, then generates from evidence without tools",async()=>{
    // MAX_SEARCHES=1：检索阶段一次（调工具）→ 生成阶段一次
    const fetchFn=transport([call("Anthropic Claude Opus 4.6 官方公告"),answer("公告：https://www.anthropic.com/news/claude-opus-4-6")]);
    const search=vi.fn(async(_query:string,_signal:AbortSignal)=>({searched:true as const,text:"untrusted excerpt",sources:[{url:"https://www.anthropic.com/news/claude-opus-4-6",title:"Opus 4.6"}]}));
    const client=new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search});
    const reply=await client.complete([{role:"user",content:"合成私人背景。请查新模型公告"}],signal());
    expect(search.mock.calls[0]![0]).toBe("Anthropic Claude Opus 4.6 官方公告");
    expect(reply).toContain("https://www.anthropic.com/news/claude-opus-4-6");
    // 生成阶段必须是干净请求：无 tools、无 tool 结果、带结构化输出
    const phase2=bodyOf(fetchFn,1);
    expect(phase2.tools).toBeUndefined();
    expect(phase2.tool_choice).toBeUndefined();
    expect(phase2.response_format).toEqual({type:"json_object"});
    const serialized=JSON.stringify(phase2.messages);
    expect(serialized).not.toContain('"role":"tool"');
    expect(serialized).toContain("untrusted excerpt"); // 证据仍然带进去
  });

  it("emits safe stage timings without adding provider requests", async () => {
    const fetchFn = transport([call("小米 MiMo 官方介绍"), answer("查到了")]);
    const search = vi.fn(async () => ({
      searched: true as const,
      text: "untrusted excerpt",
      sources: [{ url: "https://mimo.mi.com/", title: "MiMo" }]
    }));
    const events: WenliTimingEvent[] = [];
    let tick = 0;
    const client = new HttpOpenRouterWenliClient("synthetic-key", fetchFn, { search });

    await client.complete(
      [{ role: "user", content: "查一下小米 MiMo 官方介绍" }],
      signal(),
      {
        timing: {
          requestId: "wenli-diag-1",
          sink: { record: (event) => events.push(event) },
          monotonicClock: () => (tick += 11)
        }
      }
    );

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledOnce();
    expect(events.map((event) => event.stage)).toEqual([
      "tool_decision",
      "public_search",
      "final_generation"
    ]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "tool_decision", requestId: "wenli-diag-1", requestCount: 1, outcome: "success" }),
      expect.objectContaining({ stage: "public_search", requestId: "wenli-diag-1", requestCount: 1, outcome: "success" }),
      expect.objectContaining({ stage: "final_generation", requestId: "wenli-diag-1", requestCount: 1, outcome: "success" })
    ]));
    expect(events.every((event) => event.durationMs === 11)).toBe(true);
  });

  it("retries once with a stricter instruction when the model breaks the JSON contract",async()=>{
    // 这是原来必现的故障：模型回了散文。现在必须自动重试一次并成功。
    // 序列：检索阶段(不调工具) → 生成阶段(散文，违约) → 重试(合规 JSON)
    const fetchFn=transport([answer(),prose("I need to check what was discussed previously."),answer("接着上一条讲～")]);
    const client=new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search:vi.fn()});
    const reply=await client.complete([{role:"user",content:"第二条详细说说"}],signal());
    expect(reply).toContain("接着上一条讲");
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(bodyOf(fetchFn,2).messages)).toContain("did not satisfy the contract");
  });

  it("fails after one bounded retry instead of looping",async()=>{
    const fetchFn=transport([answer(),prose("第一次散文"),prose("第二次散文")]);
    const client=new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search:vi.fn()});
    await expect(client.complete([{role:"user",content:"随便问问"}],signal())).rejects.toThrow("reply invalid");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("recovers the observed MiMo unescaped quote failure with only one retry",async()=>{
    const broken='{"reply":"叫它"小歪"怎么样？(＾▽＾)","memoryUpdate":null}';
    const fetchFn=transport([prose(broken),answer('叫它“小歪”怎么样？(＾▽＾)')]);
    const client=new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search:vi.fn()});
    const raw=await client.complete([{role:"user",content:"给我画的企鹅取个外号"}],signal(),{allowSearch:false});
    expect(JSON.parse(raw)).toEqual({reply:'叫它“小歪”怎么样？(＾▽＾)',memoryUpdate:null});
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchFn,0).response_format).toEqual({type:"json_object"});
    expect(JSON.stringify(bodyOf(fetchFn,1).messages)).toContain("Escape double quotes");
  });

  it("blocks private tool arguments and bounds the tool loop",async()=>{
    const fetchFn=transport([call("示例甲主人 1002 私人健康"),call("示例乙 1001 休学"),answer("这个是私人的事呀")]);
    const search=vi.fn();
    const client=new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search});
    await client.complete([{role:"user",content:"合成案例"}],signal());
    expect(search).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("returns search failure as evidence for a natural answer without leaking errors or fake links",async()=>{
    const fetchFn=transport([call("Claude 公告"),answer("暂时没查到 https://invented.example.com")]);
    const client=new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search:async()=>{throw new Error("private secret");}});
    const result=await client.complete([{role:"user",content:"查公告"}],signal());
    // 搜索失败 → 无来源 → 未验证链接必须被标记，且不得泄漏底层错误
    expect(result).toContain("链接未核实");
    expect(JSON.stringify(fetchFn.mock.calls)).toContain("Search was attempted but no usable evidence was obtained");
    expect(JSON.stringify(fetchFn.mock.calls)).not.toContain("private secret");
  });

  it("rejects a truncated reply instead of sending half a sentence",async()=>{
    // 实测故障：追问时模型回 "示例甲主人，你说的" 这种半句话。非空检查抓不到它，
    // 会真的发到手机上，所以必须按"未说完"处理并重试一次。
    const fetchFn=transport([
      answer(),
      answer("示例甲主人，你说的"),
      answer("示例甲主人，你说的第二条是 DeepSeek API 更新日志那一页，我念念看～")
    ]);
    const client=new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search:vi.fn()});
    const reply=await client.complete([{role:"user",content:"第二条详细说说"}],signal());
    expect(reply).toContain("DeepSeek API 更新日志");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("treats a length-truncated reply as a failure and retries",async()=>{
    const truncated={choices:[{message:{role:"assistant",content:JSON.stringify({reply:"话说到一半就被截断了，后面还有很长的内容"})},finish_reason:"length"}]};
    const fetchFn=transport([answer(),truncated,answer("重新说完整：这就是结论 ^ ^")]);
    const client=new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search:vi.fn()});
    const reply=await client.complete([{role:"user",content:"讲个长问题"}],signal());
    expect(reply).toContain("重新说完整");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("gives up after one retry when the reply stays truncated",async()=>{
    const short=answer("示例甲主人，你说的");
    const fetchFn=transport([answer(),short,short]);
    const client=new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search:vi.fn()});
    await expect(client.complete([{role:"user",content:"第二条详细说说"}],signal())).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("honors cancellation without starting requests and reports unusable replies",async()=>{
    const fetchFn=transport([answer(),{choices:[{message:{content:""},finish_reason:"stop"}]},{choices:[{message:{content:""},finish_reason:"stop"}]}]);
    const client=new HttpOpenRouterWenliClient("synthetic-key",fetchFn);
    const controller=new AbortController();controller.abort();
    await expect(client.complete([],controller.signal)).rejects.toMatchObject({name:"AbortError"});
    expect(fetchFn).not.toHaveBeenCalled();
    // 空回复重试一次后仍不可用 → 必须抛错，而不是把空串当回复返回
    await expect(client.complete([],signal())).rejects.toThrow();
  });

  it("gives the search provider only a public query and accepts structured excerpts, not invented prose",async()=>{
    const fetchFn=transport([{usage:{server_tool_use:{web_search_requests:1}},choices:[{message:{content:"invented prose",annotations:[{type:"url_citation",url_citation:{url:"https://www.anthropic.com/news/claude-opus-4-6",title:"Official",content:"Official excerpt"}}]},finish_reason:"stop"}]}]);
    const search=new HttpOpenRouterPublicSearch("synthetic-key",fetchFn);
    const result=await search.search("Claude Opus 4.6 官方公告",signal());
    expect(result.text).toContain("Official excerpt");expect(result.text).not.toContain("invented prose");
    const request=bodyOf(fetchFn,0);
    expect(request.tools).toBeUndefined(); expect(request.plugins).toEqual([{id:"web",engine:"exa",max_results:3}]);
    expect(JSON.stringify(request.messages)).not.toContain("主人");
    await expect(search.search("示例乙 私人档案",signal())).rejects.toThrow("query");
  });

  it("uses the same Beijing time context for the standalone public search request", async () => {
    const fetchFn = transport([{
      usage: { server_tool_use: { web_search_requests: 1 } },
      choices: [{ message: { content: null, annotations: [] }, finish_reason: "stop" }]
    }]);
    const search = new HttpOpenRouterPublicSearch(
      "synthetic-key",
      fetchFn,
      () => new Date("2026-12-31T16:00:00.000Z")
    );

    await search.search("小米 MiMo 官方介绍", signal());

    const serialized = JSON.stringify(bodyOf(fetchFn, 0).messages);
    expect(serialized).toContain("2027-01-01T00:00:00+08:00");
    expect(serialized).toContain("UTC reference only: 2026-12-31T16:00:00.000Z");
  });

  it("rejects copied private background fragments with no fixed account names",async()=>{
    const fetchFn=transport([call("林小澄"),answer(),answer("这段资料不适合公开搜索")]);
    const search=vi.fn();
    await new HttpOpenRouterWenliClient("synthetic-key",fetchFn,{search}).complete([{role:"user",content:"合成案例"}],signal(),{privateSearchTexts:["合成人物林小澄正在紫藤中学准备比赛"]});
    expect(search).not.toHaveBeenCalled();
  });

  it("distinguishes an unexecuted search from executed but empty results",async()=>{
    const fetchFn=transport([{usage:{server_tool_use:{web_search_requests:0}},...answer()}, {usage:{server_tool_use:{web_search_requests:1}},...answer()}]);
    const search=new HttpOpenRouterPublicSearch("synthetic-key",fetchFn);
    await expect(search.search("Claude 公告",signal())).rejects.toThrow("not executed");
    await expect(search.search("Claude 公告",signal())).resolves.toMatchObject({searched:true,sources:[]});
  });
});
