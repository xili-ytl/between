import type { CloudBase } from "@cloudbase/node-sdk";
import type { CloudPersistence } from "./adapters/cloudbase-stores.js";
import { DeepSeekAiProvider } from "./adapters/deepseek-ai-provider.js";
import { CloudBaseWenliJobExecutionStore } from "./adapters/wenli-job-execution-stores.js";
import { CloudBaseWenliAgentJobStore } from "./adapters/wenli-agent-job-stores.js";
import { CloudBaseImageBytesProvider } from "./adapters/cloudbase-image-bytes.js";
import { CloudBaseWenliMemoryStore } from "./adapters/wenli-memory-stores.js";
import { HttpDeepSeekVisionClient } from "./adapters/deepseek-vision-client.js";
import { HttpDeepSeekWebSearch } from "./adapters/deepseek-web-search.js";
import { HttpOpenRouterWenliClient } from "./adapters/openrouter-wenli-client.js";
import type { AccountId } from "./domain/contracts.js";
import { DeepSeekVisionReplyGenerator } from "./services/deepseek-vision-reply-generator.js";
import { StoreWenliMomentContextProvider } from "./services/wenli-moment-context.js";
import { WenliJobWorker } from "./services/wenli-job-worker.js";
import { WenliService } from "./services/wenli-service.js";
import type { MessageStore } from "./ports/stores.js";
import {
  CloudBaseAvatarStore,
  CloudBaseContactRemarkStore,
  CloudBaseImageStorage,
  CloudBasePushRegistrationStore,
  CloudBaseReadStateStore,
  CloudBaseReleaseArtifactStore,
  CloudBaseAdminStore,
  CloudBaseLoginAttemptStore,
  CloudBaseMessageStore,
  CloudBaseMomentStore,
  CloudBasePetSessionStore,
  CloudBasePetStateStore,
  CloudBaseRelationshipStore,
  CloudBaseUserStore
} from "./adapters/cloudbase-stores.js";
import { ApiRouter } from "./api/api-router.js";
import { AuthService } from "./services/auth-service.js";
import { AdminService } from "./services/admin-service.js";
import { ChatService } from "./services/chat-service.js";
import { ImageService } from "./services/image-service.js";
import { ProfileService } from "./services/profile-service.js";
import { MomentService } from "./services/moment-service.js";
import { PetService } from "./services/pet-service.js";
import { PetAiService } from "./services/pet-ai-service.js";
import { PushService, createJpushHttp } from "./services/push-service.js";
import { ReadStateService } from "./services/read-state-service.js";
import { ReleaseService } from "./services/release-service.js";
import { CURRENT_PET_RELEASE, CURRENT_RELEASE } from "./release-manifest.js";
import { RemarkService } from "./services/remark-service.js";
import type { WenliAgentJobStore } from "./ports/wenli-agent-job-store.js";
import type { WenliMentionOutbox } from "./ports/wenli-mention-outbox.js";
import type { WenliMemoryStore } from "./ports/wenli-memory-store.js";
import { WenliTriggerService } from "./services/wenli-trigger-service.js";
import type { WenliPendingMentionReconciler } from "./services/wenli-service.js";
import { createWenliTimingSink, defaultWenliMonotonicClock } from "./domain/wenli-timing.js";

export function createApiRouter(cloud: CloudPersistence, app?: CloudBase): ApiRouter {
  const users = new CloudBaseUserStore(cloud);
  const relationships = new CloudBaseRelationshipStore(cloud);
  const avatars = new CloudBaseAvatarStore(cloud);
  const moments = new CloudBaseMomentStore(cloud);
  const messages = new CloudBaseMessageStore(cloud);
  const wenliTrigger = createWenliTriggerFromEnv(new CloudBaseWenliAgentJobStore(cloud), messages);
  const jpushAppKey = process.env.JPUSH_APP_KEY ?? "";
  const jpushMasterSecret = process.env.JPUSH_MASTER_SECRET ?? "";
  const pets = new PetService(new CloudBasePetStateStore(cloud), users, () => new Date());
  const petAi = createPetAiServiceFromEnv(pets,process.env,fetch,new CloudBaseWenliMemoryStore(cloud));
  const push = new PushService(
    new CloudBasePushRegistrationStore(cloud),
    jpushAppKey,
    jpushMasterSecret,
    createJpushHttp(jpushAppKey, jpushMasterSecret)
  );
  // 影子开关关闭（或缺少 app/模型密钥）时这里就是 undefined，接口返回 WENLI_UNAVAILABLE。
  const wenli = createWenliServiceFromEnv({
    cloud,
    messages,
    push,
    ...(wenliTrigger === undefined ? {} : { pendingMentions: wenliTrigger }),
    ...(app === undefined ? {} : { app })
  });
  return new ApiRouter(
    new AuthService(users, new CloudBaseLoginAttemptStore(cloud), new CloudBasePetSessionStore(cloud)),
    new ChatService(messages, () => new Date(), wenliTrigger),
    new ProfileService(users, avatars),
    new MomentService(moments),
    new AdminService(
      process.env.BACKUP_ADMIN_TOKEN ?? "",
      users,
      relationships,
      new CloudBaseAdminStore(cloud),
      avatars,
      () => new Date()
    ),
    new ReleaseService(CURRENT_RELEASE, new CloudBaseReleaseArtifactStore(cloud), CURRENT_PET_RELEASE),
    new RemarkService(new CloudBaseContactRemarkStore(cloud)),
    new ImageService(new CloudBaseImageStorage(cloud)),
    new ReadStateService(new CloudBaseReadStateStore(cloud), () => new Date(), messages, relationships),
    push,
    pets,
    petAi,
    wenli
  );
}

/**
 * 把「主人 @了小Q」变成一条排队任务。
 *
 * **与是否由云端执行无关**：任务创建必须始终开启，否则一旦把执行交给别处
 * （例如本机 runner 跑 Opus），消息就再也不会被排队，小Q完全不回话。
 * 之前这里和 WENLI_MOBILE_SHADOW_ENABLED 绑在一起，关闭云端执行时连带停掉了排队，
 * 已改为始终创建。
 */
export function createWenliTriggerFromEnv(
  jobs: WenliAgentJobStore,
  outbox: WenliMentionOutbox,
  _env: Readonly<Record<string, string | undefined>> = process.env,
  timingSink = createWenliTimingSink(_env)
): WenliTriggerService | undefined {
  return new WenliTriggerService(jobs, outbox, undefined, timingSink);
}

export interface WenliServiceOptions {
  /** 只有云函数运行时才有真实 CloudBase app；本地/测试不传即不启用执行路径。 */
  app?: CloudBase;
  cloud: CloudPersistence;
  messages: MessageStore;
  push?: Pick<PushService, "pushWenli">;
  pendingMentions?: WenliPendingMentionReconciler;
  env?: Readonly<Record<string, string | undefined>>;
}

/**
 * 小Q执行路径的接线（kick/sweep → 租约 worker → 模型）。
 * 影子开关默认关闭；即使打开，缺少 CloudBase app 或服务端模型密钥也不启用，
 * 保证未配置时 `wenli.kick`/`wenli.sweep` 返回 WENLI_UNAVAILABLE 而不是半开状态。
 */
export function createWenliServiceFromEnv(
  options: WenliServiceOptions
): WenliService | undefined {
  const env = options.env ?? process.env;
  if (env.WENLI_MOBILE_SHADOW_ENABLED?.trim() !== "1") return undefined;
  if (!options.app) return undefined;
  const useOpenRouter = env.WENLI_LLM_PROVIDER?.trim() === "openrouter" || (!env.WENLI_LLM_PROVIDER && !!env.OPENROUTER_API_KEY?.trim());
  const apiKey = (useOpenRouter ? env.OPENROUTER_API_KEY : env.DEEPSEEK_API_KEY)?.trim();
  if (!apiKey) return undefined;

  const timingSink = createWenliTimingSink(env);
  const timingClock = defaultWenliMonotonicClock;
  const store = new CloudBaseWenliJobExecutionStore(options.app);
  const memories = new CloudBaseWenliMemoryStore(options.cloud);
  const generator = new DeepSeekVisionReplyGenerator(
    useOpenRouter ? new HttpOpenRouterWenliClient(apiKey) : new HttpDeepSeekVisionClient(apiKey, env.WENLI_MODEL_NAME?.trim() || DEFAULT_WENLI_VISION_MODEL),
    options.messages,
    new CloudBaseImageBytesProvider(options.cloud),
    memories,
    wenliProfileNames(options.cloud),
    {
      maxContextMessages: numberEnv(env.WENLI_MAX_CONTEXT_MESSAGES, 40, 200),
      maxMemories: numberEnv(env.WENLI_MAX_MEMORIES, 12, 200),
      maxImages: numberEnv(env.WENLI_MAX_IMAGES, 3, 20),
      maxImageBytes: numberEnv(env.WENLI_MAX_IMAGE_BYTES, 12 * 1024 * 1024, 20 * 1024 * 1024),
      ...(timingSink === undefined ? {} : { timingSink, monotonicClock: timingClock })
    },
    useOpenRouter ? undefined : new HttpDeepSeekWebSearch(apiKey),
    new StoreWenliMomentContextProvider(new CloudBaseMomentStore(options.cloud))
  );
  const worker = new WenliJobWorker({
    store,
    generator,
    memoryStore: memories,
    ...(timingSink === undefined ? {} : { timingSink, monotonicClock: timingClock })
  });
  return new WenliService(
    store,
    worker,
    options.push,
    () => new Date(),
    options.pendingMentions,
    {
      sweepBudgetMs: numberEnv(env.WENLI_SWEEP_BUDGET_MS, 50_000, 300_000),
      perJobBudgetMs: numberEnv(env.WENLI_PER_JOB_BUDGET_MS, 45_000, 300_000),
      ...(timingSink === undefined ? {} : { timingSink, monotonicClock: timingClock })
    }
  );
}

/** 小Q提示词里要用的双方昵称；读取失败时回退到固定默认名。 */
function wenliProfileNames(cloud: CloudPersistence): () => Promise<Record<AccountId, string>> {
  return async () => {
    try {
      const profiles = await new ProfileService(new CloudBaseUserStore(cloud), new CloudBaseAvatarStore(cloud)).getPair();
      const names = { ...DEFAULT_WENLI_PROFILE_NAMES };
      for (const profile of profiles) {
        if (profile.accountId === "1001" || profile.accountId === "1002") {
          const displayName = profile.displayName.trim();
          if (displayName.length > 0) names[profile.accountId] = displayName;
        }
      }
      return names;
    } catch {
      return { ...DEFAULT_WENLI_PROFILE_NAMES };
    }
  };
}

function numberEnv(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return fallback;
  return parsed;
}

const DEFAULT_WENLI_VISION_MODEL = "deepseek-flash";
const DEFAULT_WENLI_PROFILE_NAMES: Record<AccountId, string> = { "1001": "示例乙", "1002": "示例甲" };

export function createPetAiServiceFromEnv(
  pets: Pick<PetService, "getState">,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchFn: typeof fetch = fetch,
  memories?: WenliMemoryStore
): PetAiService | undefined {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return undefined;
  const model = env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
  return new PetAiService(new DeepSeekAiProvider(apiKey, model, fetchFn), pets, {webSearch:new HttpDeepSeekWebSearch(apiKey,"deepseek-v4-flash",fetchFn),...(memories ? {memories} : {})});
}
