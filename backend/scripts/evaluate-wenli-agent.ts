import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { HttpOpenRouterWenliClient, WENLI_MODEL } from "../src/adapters/openrouter-wenli-client.js";
import { MemoryMessageStore, MemoryMomentStore } from "../src/adapters/memory-stores.js";
import { MemoryWenliMemoryStore } from "../src/adapters/wenli-memory-stores.js";
import { MemoryWenliJobExecutionStore } from "../src/adapters/wenli-job-execution-stores.js";
import { DeepSeekVisionReplyGenerator } from "../src/services/deepseek-vision-reply-generator.js";
import { StoreWenliMomentContextProvider } from "../src/services/wenli-moment-context.js";
import { WenliJobWorker } from "../src/services/wenli-job-worker.js";
import type { AccountId, MessageRecord } from "../src/domain/contracts.js";
import { WenliEvalBudget } from "./lib/wenli-eval-budget.js";

// This entry point deliberately has no CloudBase, login, production DB, push or cache adapter.
const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) throw new Error("OPENROUTER_API_KEY is required in the child process environment");
const maxUsd = Number(process.env.WENLI_EVAL_MAX_USD ?? "0.15");
const metadataResponse = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000), redirect: "error" });
if (!metadataResponse.ok) throw new Error("official model metadata unavailable");
const metadata = await metadataResponse.json() as { data: Array<{ id: string; pricing: { prompt: string; completion: string } }> };
const model = metadata.data.find(item => item.id === WENLI_MODEL);
if (!model) throw new Error("configured model unavailable");
const budget = new WenliEvalBudget(maxUsd, Number(model.pricing.prompt), Number(model.pricing.completion));
const usage: Array<{ model: string; costUsd: number; seconds: number; images: number; web: boolean; cachedTokens: number; stage: string; candidate: unknown; validJson: boolean }> = [];
const baseFetch = fetch;
const boundedFetch: typeof fetch = async (url, init) => {
  if (String(url) !== "https://openrouter.ai/api/v1/chat/completions" || init?.method !== "POST" || typeof init.body !== "string") throw new Error("evaluation endpoint rejected");
  const body = JSON.parse(init.body) as Record<string, unknown>;
  if (body.model !== WENLI_MODEL) throw new Error("evaluation model rejected");
  const reservation = budget.reserve(body);
  const provider = body.provider as Record<string, unknown>;
  body.provider = { ...provider, max_price: { prompt: budget.promptPrice * 1e6, completion: budget.completionPrice * 1e6 } };
  const started = performance.now();
  const response = await baseFetch(url, { ...init, body: JSON.stringify(body) });
  if (!response.ok) {
    // Stop on an HTTP error; upstream details can contain credentials or private request fragments.
    budget.stopped = true;
    return response;
  }
  const data = await response.clone().json() as { model?: string; choices?: Array<{ message?: { content?: string } }>; usage?: { cost?: number; prompt_tokens_details?: { cached_tokens?: number } } };
  budget.settle(data.usage?.cost, reservation);
  let candidate: unknown = null;
  let validJson = false;
  try { const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? ""); candidate = parsed.memoryUpdate ?? null; validJson = typeof parsed.reply === "string"; } catch {}
  usage.push({ model: data.model ?? "unavailable", costUsd: data.usage!.cost!, seconds: (performance.now() - started) / 1000,
    images: init.body.match(/"type":"image_url"/gu)?.length ?? 0, web: Array.isArray(body.plugins) && body.plugins.length > 0,
    cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0, stage: Array.isArray(body.tools) ? "tool_decision" : "generation", candidate, validJson });
  return response;
};
const client = new HttpOpenRouterWenliClient(key, boundedFetch);
const report: Array<{ id: string; speaker: AccountId; question: string; reply: string | null; seconds: number; costUsd: number; checks: Record<string, boolean>; error?: string }> = [];
const focusedCases = new Set((process.env.WENLI_EVAL_CASES ?? "").split(",").filter(Boolean));
const runId = new Date().toISOString().replace(/[:.]/gu, "-");
const resultPath = resolve(`../.superpowers/wenli-agent-eval-${focusedCases.size ? "focused" : "suite"}-${runId}.json`);
let tick = Date.now();
let sequence = 0;
const fixtureImage = shapesPng();
function session(maxContextMessages = 12) {
  const messages = new MemoryMessageStore();
  const memories = new MemoryWenliMemoryStore();
  const moments = new MemoryMomentStore();
  const jobs = new MemoryWenliJobExecutionStore(messages);
  const generator = new DeepSeekVisionReplyGenerator(client, messages, { imageBytes: async () => fixtureImage }, memories,
    async () => ({ "1001": "示例乙", "1002": "示例甲" }),
    { maxContextMessages, maxMemories: 4, maxImages: 1, maxImageBytes: 1024 * 1024 }, undefined, new StoreWenliMomentContextProvider(moments));
  const worker = new WenliJobWorker({ store: jobs, generator, memoryStore: memories, clock: () => new Date(tick) });
  return { messages, memories, moments, jobs, worker };
}
type Session = ReturnType<typeof session>;
async function append(s: Session, speaker: AccountId | "wenli", body: string): Promise<MessageRecord> {
  tick += 1000;
  const id = `eval_${++sequence}`;
  const row: MessageRecord = { id: `${speaker}_${id}`, clientMessageId: id, relationshipId: "couple", senderId: speaker,
    recipientId: speaker === "1001" ? "1002" : "1001", body, createdAt: new Date(tick).toISOString() };
  await s.messages.appendIfAbsent(row);
  return row;
}
async function ask(s: Session, id: string, speaker: AccountId, question: string, check: (reply: string) => Record<string, boolean>) {
  if (focusedCases.size && !focusedCases.has(id)) return;
  const source = await append(s, speaker, question);
  await s.jobs.createIfAbsent({ id: source.id, type: "mention", requesterId: speaker, sourceMessageId: source.id, status: "pending",
    attemptCount: 0, nextAttemptAt: source.createdAt, createdAt: source.createdAt, updatedAt: source.createdAt });
  const start = performance.now();
  const beforeCost = budget.spentUsd;
  let reply: string | null = null;
  let error: string | undefined;
  try {
    const result = await s.worker.process(source.id);
    reply = result.completed ? result.message?.body ?? null : null;
    if (!reply) error = (await s.jobs.get(source.id))?.lastErrorCode ?? "NO_VALIDATED_REPLY";
  } catch { error = "EVALUATION_FAILED"; }
  report.push({ id, speaker, question, reply, seconds: (performance.now() - start) / 1000, costUsd: budget.spentUsd - beforeCost,
    checks: reply ? { parsed: true, noDiagnostics: !/耗时|候选通过|memoryUpdate|tool_calls|speakerRole/u.test(reply), ...check(reply) } : { parsed: false }, ...(error ? { error } : {}) });
  console.log(JSON.stringify(report.at(-1)));
  await save();
  if (budget.stopped) throw new Error("evaluation stopped after upstream or billing failure");
}
async function save() {
  await mkdir(resolve("../.superpowers"), { recursive: true });
  await writeFile(resultPath, JSON.stringify({ createdAt: new Date().toISOString(), syntheticOnly: true, configuredModel: WENLI_MODEL,
    pricingPerToken: model!.pricing, budgetUsd: maxUsd, spentUsd: budget.spentUsd, reservedUnknownUsd: budget.reservedUsd, usage, cases: report }, null, 2));
}
try {
  for (const [speaker, name] of [["1002", "示例甲"], ["1001", "示例乙"]] as const) {
    await ask(session(), `identity-${speaker}`, speaker, "@问理 我是谁？", r => ({ speaker: r.includes(name), notSelf: !/你是问理/u.test(r) }));
  }
  await ask(session(), "penguin-cute", "1002", "@问理 你是企鹅为什么还喵？", r => ({ playful: /卖萌|可爱|逗|学猫|撒娇/u.test(r) }));
  const irony = session();
  await append(irony, "1002", "排队买栗子呢，闻着好香，马上到我了。");
  await ask(irony, "irony", "1002", "@问理 真棒，排了半小时的队，轮到我刚好卖完。", r => ({ understands: /倒霉|白等|白排|失望|气|难受|心疼|呜|哭|哎|唉|惨|扑空|没吃上/u.test(r), noCongrats: !/恭喜|太棒了/u.test(r) }));
  const tutorial = session();
  await append(tutorial, "1002", "@问理 教我矩阵快速幂，写 Markdown，含代码和斐波那契例子，演示算出 F(10)。");
  await append(tutorial, "wenli", "好呀，我把原理和模板整理成 Markdown 给你。");
  await ask(tutorial, "pending-delivery", "1002", "@问理 给我呀", r => ({ deliverNow: r.length > 200 && /```/u.test(r) && /矩阵/u.test(r), noAmnesia: !/给你什么|给我什么/u.test(r) }));
  const posts = session();
  const moment = { id: "1002_eval_shapes", authorId: "1002" as const, clientMomentId: "eval_shapes", body: "今天画了个测试书签", visibility: "PARTNER" as const, deleting: false,
    createdAt: new Date(tick - 60_000).toISOString(), imageFileId: "cloud://synthetic/moments-images/1002_eval_shapes.png", imageMimeType: "image/png" as const };
  await posts.moments.appendMomentIfAbsent(moment);
  await posts.moments.appendCommentToVisibleMomentIfAbsent({ id: "1001_eval_comment", authorId: "1001", clientCommentId: "eval_comment", momentId: moment.id,
    body: "左边那个像小太阳", createdAt: new Date(tick).toISOString() });
  await ask(posts, "moment-image", "1002", "@问理 朋友圈里我画的测试书签，图片里左右分别是什么？", r => ({ realImage: /红/u.test(r) && /蓝/u.test(r) && /圆/u.test(r) && /方/u.test(r) }));
  await ask(posts, "moment-follow-up", "1002", "@问理 那她在下面评论了什么？", r => ({ commentSource: /小太阳/u.test(r) && /示例乙|她/u.test(r) }));
  const memory = session(40);
  await ask(memory, "remember", "1002", "@问理 记住，我喜欢蓝色杯子，好吗？", () => ({}));
  if (report.at(-1)?.id === "remember") report.at(-1)!.checks.persisted = (await memory.memories.listForContext(200)).some(m => m.summary.includes("蓝色杯子"));
  await append(memory, "1001", "这是虚构测试的无关间隔消息。");
  await ask(memory, "recall", "1002", "@问理 我喜欢什么颜色的杯子？", r => ({ recalled: /蓝/u.test(r) }));
  await ask(memory, "do-not-forget", "1002", "@问理 请别忘记我的杯子偏好，先不用复述颜色。", () => ({}));
  if (report.at(-1)?.id === "do-not-forget") report.at(-1)!.checks.retained = (await memory.memories.listForContext(200)).some(m => m.summary.includes("蓝色杯子"));
  await ask(memory, "correct", "1002", "@问理 纠正一下，我现在喜欢绿色杯子", () => ({}));
  await append(memory, "1001", "这是另一条无关间隔消息。");
  await ask(memory, "recall-corrected", "1002", "@问理 我现在喜欢什么颜色的杯子？", r => ({ corrected: /绿/u.test(r) && !/蓝/u.test(r) }));
  await ask(memory, "forget", "1002", "@问理 忘记我的杯子偏好", () => ({}));
  if (report.at(-1)?.id === "forget") report.at(-1)!.checks.forgotten = (await memory.memories.listForContext(200)).length === 0;
  await append(memory, "1001", "第三条无关间隔消息。");
  await ask(memory, "recall-forgotten", "1002", "@问理 我喜欢什么颜色的杯子？", r => ({ notInvented: !/喜欢.{0,8}[蓝绿]|[蓝绿].{0,8}杯/u.test(r) }));
  await ask(session(), "web-capability", "1002", "@问理 你能联网吗？", r => ({ capability: /能|可以/u.test(r) }));
  await ask(session(), "public-search", "1002", "@问理 搜索小米 MiMo V2.6 的官方发布页，给我一条来源就好。", r => ({ verifiedSource: /https:\/\//u.test(r) }));
} finally { await save(); }
const failedChecks = report.filter(item => Object.values(item.checks).some(value => !value)).map(item => item.id);
console.log(JSON.stringify({ resultPath, cases: report.length, failedChecks, spentUsd: budget.spentUsd }));
process.exitCode = failedChecks.length ? 1 : 0;

/** Generated fixture: red circle on the left, blue square on the right. */
function shapesPng(): Uint8Array {
  const width = 128, height = 96;
  const pixels = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) {
    const line = y * (width * 3 + 1); pixels[line] = 0;
    for (let x = 0; x < width; x++) {
      const color = (x - 32) ** 2 + (y - 48) ** 2 < 400 ? [230, 30, 30] : x >= 78 && x < 114 && y >= 30 && y < 66 ? [30, 70, 230] : [255, 255, 255];
      for (let c = 0; c < 3; c++) pixels[line + 1 + x * 3 + c] = color[c]!;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  function chunk(type: string, data: Buffer) {
    const part = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of part) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); part.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8); return result;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
