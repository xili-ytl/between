import { describe, expect, it, vi } from "vitest";
import { MemoryWenliAgentJobStore } from "../src/adapters/wenli-agent-job-stores.js";
import { MemoryMessageStore } from "../src/adapters/memory-stores.js";
import { createPetAiServiceFromEnv, createWenliServiceFromEnv, createWenliTriggerFromEnv } from "../src/app-factory.js";
import { WenliTriggerService } from "../src/services/wenli-trigger-service.js";
import { WenliService } from "../src/services/wenli-service.js";

const pets = {
  getState: async () => ({
    name: "企鹅",
    host: "示例乙 & 示例甲",
    sex: "公" as const,
    level: 1,
    growth: 0,
    hunger: 1000,
    hunger_max: 3100,
    clean: 1500,
    clean_max: 3100,
    health: 5,
    mood: 500,
    mood_max: 1000,
    yb: 1000,
    intel: 0,
    charm: 0,
    strong: 0,
    is_hungry: false,
    is_dirty: false,
    is_sad: false,
    is_sick: false,
    is_dead: false,
    updatedAt: "2026-08-11T00:00:00.000Z",
    updatedBy: "1001" as const
  })
};

describe("Q pet AI app wiring", () => {
  it("leaves the rest of the API available when the server key is absent", () => {
    expect(createPetAiServiceFromEnv(pets, {}, vi.fn())).toBeUndefined();
  });

  it("reads the DeepSeek key and model only from server environment", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "云端小Q" } }]
    }), { status: 200 }));
    const service = createPetAiServiceFromEnv(pets, {
      DEEPSEEK_API_KEY: "cloudbase-secret",
      DEEPSEEK_MODEL: "deepseek-server-model"
    }, fetchFn);

    await expect(service?.chat("1002", "你好")).resolves.toEqual({ reply: "云端小Q" });
    const [, init] = fetchFn.mock.calls[0]!;
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cloudbase-secret");
    expect(JSON.parse(String(init?.body)).model).toBe("deepseek-server-model");
  });
});

describe("mobile Wenli shadow wiring", () => {
  it.each([
    {},
    { WENLI_MOBILE_SHADOW_ENABLED: "" },
    { WENLI_MOBILE_SHADOW_ENABLED: "true" },
    { WENLI_MOBILE_SHADOW_ENABLED: "0" }
  ])("always queues mentions so another executor can pick them up", (env) => {
    // 排队与执行分离：关掉云端执行（shadow=0）时，任务仍必须被创建，
    // 否则本机 runner 永远领不到任务，小Q完全不回话。
    expect(createWenliTriggerFromEnv(new MemoryWenliAgentJobStore(), new MemoryMessageStore(), env))
      .toBeInstanceOf(WenliTriggerService);
  });

  it("creates a working durable trigger regardless of the shadow flag", async () => {
    const jobs = new MemoryWenliAgentJobStore();
    const messages = new MemoryMessageStore();
    const trigger = createWenliTriggerFromEnv(
      jobs,
      messages,
      { WENLI_MOBILE_SHADOW_ENABLED: "0" }
    );

    expect(trigger).toBeInstanceOf(WenliTriggerService);
    const source = await messages.appendIfAbsent({
      id: "1002_ask-1",
      relationshipId: "couple",
      senderId: "1002",
      recipientId: "1001",
      clientMessageId: "ask-1",
      body: "@小Q 你好",
      createdAt: "2026-08-30T00:00:00.000Z"
    }, { captureWenliMention: true });
    await trigger!.afterHumanMessage(source);
    await expect(jobs.get("1002_ask-1")).resolves.toMatchObject({ status: "pending" });
  });
});

describe("mobile Wenli kick and sweep wiring", () => {
  const cloud = {} as never;
  // 只需要 database()：构造执行 store 时会调用，本组测试不真正查库。
  const app = { database: () => ({}) } as never;

  it("enables Opus without a DeepSeek key and never falls back when its explicit key is missing", () => {
    const base={app,cloud,messages:new MemoryMessageStore()};
    expect(createWenliServiceFromEnv({...base,env:{WENLI_MOBILE_SHADOW_ENABLED:"1",WENLI_LLM_PROVIDER:"openrouter",OPENROUTER_API_KEY:"synthetic-key"}})).toBeInstanceOf(WenliService);
    expect(createWenliServiceFromEnv({...base,env:{WENLI_MOBILE_SHADOW_ENABLED:"1",WENLI_LLM_PROVIDER:"openrouter",DEEPSEEK_API_KEY:"synthetic-key"}})).toBeUndefined();
  });

  it.each([
    {},
    { WENLI_MOBILE_SHADOW_ENABLED: "" },
    { WENLI_MOBILE_SHADOW_ENABLED: "true" },
    { WENLI_MOBILE_SHADOW_ENABLED: "0" }
  ])("stays disabled unless the server flag is exactly 1", (env) => {
    expect(createWenliServiceFromEnv({ app, cloud, messages: new MemoryMessageStore(), env })).toBeUndefined();
  });

  it("stays disabled without a CloudBase app even when the flag is on", () => {
    expect(createWenliServiceFromEnv({
      cloud,
      messages: new MemoryMessageStore(),
      env: { WENLI_MOBILE_SHADOW_ENABLED: "1", DEEPSEEK_API_KEY: "cloudbase-secret" }
    })).toBeUndefined();
  });

  it("stays disabled without a server model key", () => {
    expect(createWenliServiceFromEnv({
      app,
      cloud,
      messages: new MemoryMessageStore(),
      env: { WENLI_MOBILE_SHADOW_ENABLED: "1", DEEPSEEK_API_KEY: "   " }
    })).toBeUndefined();
  });

  it("builds a working service when the flag, app and key are all present", async () => {
    const service = createWenliServiceFromEnv({
      app,
      cloud,
      messages: new MemoryMessageStore(),
      env: { WENLI_MOBILE_SHADOW_ENABLED: " 1 ", DEEPSEEK_API_KEY: "cloudbase-secret" }
    });

    expect(service).toBeInstanceOf(WenliService);
    // 参数校验发生在触碰云端之前，用它证明实例是活的而不是空壳。
    await expect(service!.sweep(0)).rejects.toMatchObject({ code: "PAGE_SIZE_INVALID" });
  });
});
