import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryAvatarStore,
  MemoryAdminStore,
  MemoryLoginAttemptStore,
  MemoryContactRemarkStore,
  MemoryImageStorage,
  MemoryMessageStore,
  MemoryMomentStore,
  MemoryPetSessionStore,
  MemoryPetStateStore,
  MemoryPushRegistrationStore,
  MemoryReadStateStore,
  MemoryRelationshipStore,
  MemoryUserStore
} from "../src/adapters/memory-stores.js";
import { ADMIN_ACTIONS, API_ACTIONS, ApiRouter } from "../src/api/api-router.js";
import { MemoryWenliJobExecutionStore } from "../src/adapters/wenli-job-execution-stores.js";
import { INITIAL_PROFILES, type AccountId, type MessageRecord, type UserRecord } from "../src/domain/contracts.js";
import { deterministicWenliReplyId } from "../src/domain/wenli-reply.js";
import { hashPassword } from "../src/security/password.js";
import { AuthService } from "../src/services/auth-service.js";
import { AdminService } from "../src/services/admin-service.js";
import { ChatService } from "../src/services/chat-service.js";
import { ImageService } from "../src/services/image-service.js";
import { MomentService } from "../src/services/moment-service.js";
import type { PetAiService } from "../src/services/pet-ai-service.js";
import { PetService } from "../src/services/pet-service.js";
import { ProfileService } from "../src/services/profile-service.js";
import { PushService, type JpushHttp } from "../src/services/push-service.js";
import { ReadStateService } from "../src/services/read-state-service.js";
import { ReleaseService } from "../src/services/release-service.js";
import { RemarkService } from "../src/services/remark-service.js";
import { WenliJobWorker } from "../src/services/wenli-job-worker.js";
import { WenliService } from "../src/services/wenli-service.js";

const INITIAL_AVATAR_BYTES: Record<AccountId, Uint8Array> = {
  "1001": new Uint8Array(await readFile(new URL("../assets/initial-avatars/1001.jpg", import.meta.url))),
  "1002": new Uint8Array(await readFile(new URL("../assets/initial-avatars/1002.jpg", import.meta.url)))
};

describe("ApiRouter", () => {
  let router: ApiRouter;
  let backups: MemoryAdminStore;
  let pushHttp: JpushHttp;
  let pushRegistrations: MemoryPushRegistrationStore;
  let petAiCalls: Array<Record<string, unknown>>;
  let users: MemoryUserStore;

  beforeEach(async () => {
    users = new MemoryUserStore();
    await users.save(await user("1001"));
    await users.save(await user("1002"));
    const relationships = new MemoryRelationshipStore();
    const avatars = new MemoryAvatarStore();
    const moments = new MemoryMomentStore();
    backups = new MemoryAdminStore();
    pushHttp = { sendPush: async () => undefined };
    pushRegistrations = new MemoryPushRegistrationStore();
    petAiCalls = [];
    const petAi = {
      chat: async (accountId: AccountId, userText: string, history: unknown) => {
        petAiCalls.push({ kind: "chat", accountId, userText, history });
        return { reply: "云端回复" };
      },
      speak: async (accountId: AccountId, promptType: string, context: Record<string, unknown>) => {
        petAiCalls.push({ kind: "speak", accountId, promptType, context });
        return { tolk: "云端台词", submitText: "嗯" };
      },
      task: async (accountId: AccountId, taskType: string, input: Record<string, unknown>) => {
        petAiCalls.push({ kind: "task", accountId, taskType, input });
        return { text: "云端总结" };
      }
    } as PetAiService;
    router = new ApiRouter(
      new AuthService(users, new MemoryLoginAttemptStore(), new MemoryPetSessionStore()),
      new ChatService(new MemoryMessageStore(), () => new Date("2026-08-06T00:00:00.000Z")),
      new ProfileService(users, avatars),
      new MomentService(moments, () => new Date("2026-08-07T00:00:00.000Z")),
      new AdminService(
        "admin-secret",
        users,
        relationships,
        backups,
        avatars,
        () => new Date("2026-08-07T08:09:10.000Z")
      ),
      new ReleaseService(
        {
          versionCode: 6,
          versionName: "1.0",
          notes: "优化聊天输入和头像同步",
          apkKey: "releases/between-6.apk",
          sha256: "a".repeat(64)
        },
        { temporaryUrl: async (key) => `https://download.test/${key}` },
        {
          version: "0.1.4",
          versionCode: 4,
          notes: ["应用内更新"],
          artifactKey: "releases/pet/between-qpet-0.1.4.exe",
          size: 1024,
          sha256: "b".repeat(64),
          signature: `${"A".repeat(86)}==`
        }
      ),
      new RemarkService(new MemoryContactRemarkStore(), () => new Date("2026-08-08T08:00:00.000Z")),
      new ImageService(new MemoryImageStorage()),
      new ReadStateService(new MemoryReadStateStore(), () => new Date("2026-08-09T00:00:00.000Z")),
      new PushService(
        pushRegistrations,
        "app-key",
        "master-secret",
        pushHttp,
        () => new Date("2026-08-09T00:00:00.000Z")
      ),
      new PetService(new MemoryPetStateStore(), users, () => new Date("2026-08-10T00:00:00.000Z")),
      petAi
    );
  });

  it("provides a public health check and stable error envelope", async () => {
    await expect(router.handle({ action: "system.health", payload: {} }, "127.0.0.1")).resolves.toEqual({
      ok: true,
      data: { status: "ok" }
    });
    await expect(router.handle({ action: "unknown", payload: {} }, "127.0.0.1")).resolves.toEqual({
      ok: false,
      error: { code: "ACTION_INVALID", message: "不支持的操作" }
    });
  });

  it("provides public release metadata without rotating an app session", async () => {
    await expect(router.handle({ action: "system.version", payload: {} }, "127.0.0.1")).resolves.toEqual({
      ok: true,
      data: {
        versionCode: 6,
        versionName: "1.0",
        notes: "优化聊天输入和头像同步",
        downloadUrl: "https://download.test/releases/between-6.apk",
        sha256: "a".repeat(64)
      }
    });
  });

  it("provides the desktop pet release for in-app updates", async () => {
    await expect(router.handle({ action: "system.petVersion", payload: {} }, "127.0.0.1")).resolves.toEqual({
      ok: true,
      data: {
        version: "0.1.4",
        versionName: "0.1.4",
        versionCode: 4,
        notes: ["应用内更新"],
        artifactKey: "releases/pet/between-qpet-0.1.4.exe",
        size: 1024,
        signature: `${"A".repeat(86)}==`,
        downloadUrl: "https://download.test/releases/pet/between-qpet-0.1.4.exe",
        sha256: "b".repeat(64)
      }
    });
  });

  it("logs in and requires the app session for protected actions", async () => {
    const login = await router.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    expect(login).toMatchObject({ ok: true, data: { accountId: "1001" } });

    await expect(
      router.handle({ action: "chat.send", payload: { clientMessageId: "m-1", body: "你好" } }, "127.0.0.1")
    ).resolves.toMatchObject({ ok: false, error: { code: "SESSION_INVALID" } });

    const sessionToken = valueOf(login, "sessionToken");
    await expect(
      router.handle(
        {
          action: "chat.send",
          sessionToken,
          payload: { clientMessageId: "m-1", body: "你好" }
        },
        "127.0.0.1"
      )
    ).resolves.toMatchObject({ ok: true, data: { id: "1001_m-1", recipientId: "1002" } });
  });

  it("pet login reads recent chat but is rejected for every write action", async () => {
    // 手机上先登录（模拟真实在线）
    const phoneLogin = await router.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    // Q 宠用 pet.login 登录（手机不掉线）
    const petLogin = await router.handle(
      { action: "pet.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.2"
    );
    expect(petLogin).toMatchObject({ ok: true, data: { accountId: "1001" } });
    const phoneToken = valueOf(phoneLogin, "sessionToken");
    const petToken = valueOf(petLogin, "sessionToken");

    // 主会话仍有效：手机没有被 pet 登录顶掉
    await expect(router.handle({ action: "profile.get", sessionToken: phoneToken, payload: {} }, "127.0.0.1"))
      .resolves.toMatchObject({ ok: true, data: [{ accountId: "1001" }, { accountId: "1002" }] });

    // pet 只读白名单：可读 profile / chat.before / chat.after / moments.list
    await expect(router.handle({ action: "profile.get", sessionToken: petToken, payload: {} }, "127.0.0.2"))
      .resolves.toMatchObject({ ok: true, data: [{ accountId: "1001" }, { accountId: "1002" }] });
    await expect(router.handle({
      action: "chat.before",
      sessionToken: petToken,
      payload: { cursor: null, limit: 50 }
    }, "127.0.0.2")).resolves.toMatchObject({ ok: true, data: { items: [] } });
    await expect(router.handle({
      action: "chat.after",
      sessionToken: petToken,
      payload: { cursor: null, limit: 50 }
    }, "127.0.0.2")).resolves.toMatchObject({ ok: true, data: { items: [] } });
    await expect(router.handle({ action: "moments.list", sessionToken: petToken, payload: {} }, "127.0.0.2"))
      .resolves.toEqual({ ok: true, data: [] });

    // pet 写操作/账号操作一律拒绝
    await expect(router.handle({
      action: "chat.send",
      sessionToken: petToken,
      payload: { clientMessageId: "pet-m-1", body: "我想说话" }
    }, "127.0.0.2")).resolves.toMatchObject({ ok: false, error: { code: "PET_READONLY" } });
    await expect(router.handle({
      action: "moments.create",
      sessionToken: petToken,
      payload: { clientMomentId: "pet-post-1", body: "hi", visibility: "PARTNER" }
    }, "127.0.0.2")).resolves.toMatchObject({ ok: false, error: { code: "PET_READONLY" } });
    await expect(router.handle({
      action: "profile.update",
      sessionToken: petToken,
      payload: { displayName: "改名字" }
    }, "127.0.0.2")).resolves.toMatchObject({ ok: false, error: { code: "PET_READONLY" } });
    await expect(router.handle({
      action: "chat.readState.set",
      sessionToken: petToken,
      payload: { lastReadMessageId: "1002_m1", lastReadMessageCreatedAt: "2026-08-09T00:00:00.000Z" }
    }, "127.0.0.2")).resolves.toMatchObject({ ok: false, error: { code: "PET_READONLY" } });
    // pet token 无法认证主会话操作（logout），被拒且绝不影响手机账号
    await expect(router.handle({ action: "auth.logout", sessionToken: petToken, payload: {} }, "127.0.0.2"))
      .resolves.toMatchObject({ ok: false, error: { code: "SESSION_INVALID" } });

    // pet 会话能读共享宠物状态、能操作宠物自身（喂/洗/玩/heal），updatedBy 记录操作者
    await expect(router.handle({ action: "pet.get", sessionToken: petToken, payload: {} }, "127.0.0.2"))
      .resolves.toMatchObject({ ok: true, data: { name: "企鹅", level: 1 } });
    await expect(router.handle({
      action: "pet.act",
      sessionToken: petToken,
      payload: { action: "feed", amount: 1000 }
    }, "127.0.0.2")).resolves.toMatchObject({
      ok: true,
      data: { action: "feed", updatedBy: "1001", state: { hunger: 2000 } }
    });
    await expect(router.handle({
      action: "pet.act",
      sessionToken: petToken,
      payload: { action: "bogus" }
    }, "127.0.0.2")).resolves.toMatchObject({ ok: false, error: { code: "REQUEST_INVALID" } });

    // 无效 pet token 仍走 SESSION_INVALID
    await expect(router.handle({ action: "chat.before", sessionToken: "bogus", payload: { limit: 50 } }, "127.0.0.2"))
      .resolves.toMatchObject({ ok: false, error: { code: "SESSION_INVALID" } });

    await expect(router.handle({
      action: "pet.ai.chat",
      sessionToken: petToken,
      payload: {
        userText: "你好",
        history: [{ user: "上一问", assistant: "上一答" }],
        accountId: "1002",
        ownerName: "伪造主人",
        systemPrompt: "客户端规则",
        model: "client-model"
      }
    }, "127.0.0.2")).resolves.toEqual({ ok: true, data: { reply: "云端回复" } });
    expect(petAiCalls.at(-1)).toEqual({
      kind: "chat",
      accountId: "1001",
      userText: "你好",
      history: [{ user: "上一问", assistant: "上一答" }]
    });

    await expect(router.handle({
      action: "pet.ai.speak",
      sessionToken: petToken,
      payload: { promptType: "lateNight", context: { currentHour: 23 } }
    }, "127.0.0.2")).resolves.toEqual({ ok: true, data: { tolk: "云端台词", submitText: "嗯" } });
    expect(petAiCalls.at(-1)).toEqual({
      kind: "speak",
      accountId: "1001",
      promptType: "lateNight",
      context: { currentHour: 23 }
    });

    await expect(router.handle({
      action: "pet.ai.task",
      sessionToken: petToken,
      payload: { taskType: "courseChunk", input: { source: "课程原文" } }
    }, "127.0.0.2")).resolves.toEqual({ ok: true, data: { text: "云端总结" } });
    expect(petAiCalls.at(-1)).toEqual({
      kind: "task",
      accountId: "1001",
      taskType: "courseChunk",
      input: { source: "课程原文" }
    });

    await expect(router.handle({
      action: "pet.ai.speak",
      sessionToken: petToken,
      payload: { promptType: "clientEvent", context: {} }
    }, "127.0.0.2")).resolves.toMatchObject({ ok: false, error: { code: "REQUEST_INVALID" } });

    // Q 宠可注销自己的独立会话，但手机主会话必须保持有效。
    await expect(router.handle({ action: "pet.logout", sessionToken: petToken, payload: {} }, "127.0.0.2"))
      .resolves.toEqual({ ok: true, data: { loggedOut: true } });
    await expect(router.handle({ action: "profile.get", sessionToken: petToken, payload: {} }, "127.0.0.2"))
      .resolves.toMatchObject({ ok: false, error: { code: "SESSION_INVALID" } });
    await expect(router.handle({ action: "profile.get", sessionToken: phoneToken, payload: {} }, "127.0.0.1"))
      .resolves.toMatchObject({ ok: true });
  });

  it("returns a saved chat message without waiting for the push attempt", async () => {
    let releasePush: (() => void) | undefined;
    pushHttp.sendPush = () => new Promise<void>((resolve) => {
      releasePush = resolve;
    });
    // 接收方已注册设备；否则 pushTo 现在会直接 no-op，不再触发推送请求。
    await pushRegistrations.save({
      id: "1002",
      accountId: "1002",
      registrationId: "reg-1002",
      platform: "android",
      updatedAt: "2026-08-09T00:00:00.000Z"
    });
    const login = await router.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    const resultPromise = router.handle({
      action: "chat.send",
      sessionToken: valueOf(login, "sessionToken"),
      payload: { clientMessageId: "push-await", body: "你好" }
    }, "127.0.0.1");

    let settled = false;
    void resultPromise.then(() => { settled = true; });
    await vi.waitFor(() => expect(releasePush).toBeTypeOf("function"));
    await Promise.resolve();
    expect(settled).toBe(true);

    releasePush?.();
    await expect(resultPromise).resolves.toMatchObject({ ok: true, data: { id: "1001_push-await" } });
  });

  it("never exposes password or server-side session hashes", async () => {
    const login = await router.handle(
      { action: "auth.login", payload: { accountId: "1002", password: "1013" } },
      "127.0.0.1"
    );
    const response = await router.handle(
      { action: "profile.get", sessionToken: valueOf(login, "sessionToken"), payload: {} },
      "127.0.0.1"
    );
    const serialized = JSON.stringify(response);

    expect(response).toMatchObject({ ok: true, data: [{ accountId: "1001" }, { accountId: "1002" }] });
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("sessionHash");
  });

  it("stores a remark only for the authenticated owner", async () => {
    const login1001 = await router.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    const login1002 = await router.handle(
      { action: "auth.login", payload: { accountId: "1002", password: "1013" } },
      "127.0.0.2"
    );

    await expect(router.handle({
      action: "remark.set",
      sessionToken: valueOf(login1001, "sessionToken"),
      payload: { targetId: "1002", remark: "宝宝", ownerId: "1002" }
    }, "127.0.0.1")).resolves.toMatchObject({ ok: true, data: { targetId: "1002", remark: "宝宝" } });

    await expect(router.handle({
      action: "remark.get",
      sessionToken: valueOf(login1002, "sessionToken"),
      payload: { targetId: "1001" }
    }, "127.0.0.2")).resolves.toEqual({
      ok: true,
      data: { targetId: "1001", remark: "", updatedAt: null }
    });
  });

  it("gets and sets the read state for the authenticated account only", async () => {
    const login = await router.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    const token = valueOf(login, "sessionToken");

    await expect(router.handle({
      action: "chat.readState.get",
      sessionToken: token,
      payload: {}
    }, "127.0.0.1")).resolves.toMatchObject({ ok: true, data: { accountId: "1001" } });

    await expect(router.handle({
      action: "chat.readState.set",
      sessionToken: token,
      payload: {
        lastReadMessageId: "1002_m1",
        lastReadMessageCreatedAt: "2026-08-09T00:00:01.000Z",
        lastSeenMomentAt: "2026-08-09T00:00:02.000Z"
      }
    }, "127.0.0.1")).resolves.toMatchObject({
      ok: true,
      data: { lastReadMessageId: "1002_m1", lastSeenMomentAt: "2026-08-09T00:00:02.000Z" }
    });

    await expect(router.handle({
      action: "chat.readState.get",
      sessionToken: token,
      payload: {}
    }, "127.0.0.1")).resolves.toMatchObject({ ok: true, data: { lastReadMessageId: "1002_m1" } });

    await expect(router.handle({
      action: "chat.readState.set",
      sessionToken: token,
      payload: {
        lastReadMessageId: "1002_m0",
        lastReadMessageCreatedAt: "2026-08-09T00:00:00.000Z"
      }
    }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "READ_STATE_BEHIND" } });
  });

  it("registers and unregisters the push device for the authenticated account", async () => {
    const login = await router.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    const token = valueOf(login, "sessionToken");

    await expect(router.handle({
      action: "push.register",
      sessionToken: token,
      payload: { registrationId: "reg-device-1" }
    }, "127.0.0.1")).resolves.toMatchObject({
      ok: true,
      data: { accountId: "1001", registrationId: "reg-device-1" }
    });

    await expect(router.handle({
      action: "push.unregister",
      sessionToken: token,
      payload: {}
    }, "127.0.0.1")).resolves.toMatchObject({ ok: true, data: { unregistered: true } });
  });

  it("issues upload credentials and image urls only to the authenticated owner", async () => {
    const login = await router.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    const sessionToken = valueOf(login, "sessionToken");

    const credential = await router.handle({
      action: "chat.imageUploadCredential",
      sessionToken,
      payload: { clientMessageId: "img-1", imageMimeType: "image/jpeg" }
    }, "127.0.0.1");
    expect(credential).toMatchObject({
      ok: true,
      data: {
        authorization: "memory-authorization",
        fileId: "cloud://memory-bucket/chat-images/1001_img-1.jpg"
      }
    });

    await expect(router.handle({
      action: "chat.imageUrl",
      sessionToken,
      payload: { imageFileId: "cloud://env-bucket/chat-images/1001_img-1.jpg" }
    }, "127.0.0.1")).resolves.toMatchObject({
      ok: true,
      data: { url: expect.stringContaining("chat-images/1001_img-1.jpg") }
    });
  });

  it("rejects image actions without a valid session", async () => {
    await expect(router.handle({
      action: "chat.imageUploadCredential",
      payload: { clientMessageId: "img-1", imageMimeType: "image/jpeg" }
    }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "SESSION_INVALID" } });
  });

  it("sends an image message with validated metadata", async () => {
    const login = await router.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    const sessionToken = valueOf(login, "sessionToken");

    await expect(router.handle({
      action: "chat.send",
      sessionToken,
      payload: {
        clientMessageId: "img-1",
        body: "",
        type: "image",
        imageFileId: "cloud://env-bucket/chat-images/1001_img-1.jpg",
        imageMimeType: "image/jpeg",
        imageWidth: 800,
        imageHeight: 600
      }
    }, "127.0.0.1")).resolves.toMatchObject({
      ok: true,
      data: {
        type: "image",
        imageFileId: "cloud://env-bucket/chat-images/1001_img-1.jpg",
        imageWidth: 800,
        imageHeight: 600
      }
    });
  });

  it("returns a directly displayable avatar URL without exposing storage credentials", async () => {
    const login = await router.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    const sessionToken = valueOf(login, "sessionToken");
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    await router.handle({
      action: "profile.updateAvatar",
      sessionToken,
      payload: { contentType: "image/png", base64: pngHeader }
    }, "127.0.0.1");

    const profiles = await router.handle({ action: "profile.get", sessionToken, payload: {} }, "127.0.0.1");
    expect(profiles).toMatchObject({ ok: true });
    expect(profiles.ok && Array.isArray(profiles.data) ? profiles.data[0] : null).toMatchObject({
      accountId: "1001",
      avatarUrl: expect.stringMatching(/^memory:\/\/avatars\/1001\/[a-f0-9]{12}\.png$/)
    });
    expect(JSON.stringify(profiles)).not.toContain("storageKey");
  });

  it("returns gender from every public profile action", async () => {
    const login = await router.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    const sessionToken = valueOf(login, "sessionToken");

    await expect(router.handle({ action: "profile.get", sessionToken, payload: {} }, "127.0.0.1"))
      .resolves.toMatchObject({
        ok: true,
        data: [
          { accountId: "1001", displayName: "示例乙", gender: "女" },
          { accountId: "1002", displayName: "示例甲", gender: "男" }
        ]
      });
    await expect(router.handle({
      action: "profile.update",
      sessionToken,
      payload: { displayName: "新名字" }
    }, "127.0.0.1")).resolves.toMatchObject({
      ok: true,
      data: { accountId: "1001", displayName: "新名字", gender: "女" }
    });
    await expect(router.handle({
      action: "profile.updateAvatar",
      sessionToken,
      payload: { contentType: "image/jpeg", base64: Buffer.from([0xff, 0xd8, 0xff]).toString("base64") }
    }, "127.0.0.1")).resolves.toMatchObject({
      ok: true,
      data: { accountId: "1001", displayName: "新名字", gender: "女" }
    });
  });

  it("keeps chat permanent while exposing only scoped Moments deletion actions", () => {
    expect(API_ACTIONS).toEqual([
      "auth.login",
      "auth.logout",
      "auth.changePassword",
      "pet.login",
      "pet.logout",
      "pet.ai.chat",
      "pet.ai.speak",
      "pet.ai.task",
      "profile.get",
      "profile.update",
      "profile.updateAvatar",
      "chat.send",
      "chat.after",
      "chat.before",
      "chat.imageUploadCredential",
      "chat.imageUrl",
      "chat.readState.get",
      "chat.readState.set",
      "push.register",
      "push.unregister",
      "remark.get",
      "remark.set",
      "moments.list",
      "moments.create",
      "moments.imageUploadCredential",
      "moments.delete",
      "moments.like",
      "moments.unlike",
      "moments.comments.create",
      "moments.comments.delete",
      "pet.get",
      "pet.act",
      "wenli.kick",
      "wenli.sweep",
      "system.health",
      "system.version",
      "system.petVersion"
    ]);
    expect(API_ACTIONS.filter((action) => action.startsWith("chat."))).toEqual([
      "chat.send",
      "chat.after",
      "chat.before",
      "chat.imageUploadCredential",
      "chat.imageUrl",
      "chat.readState.get",
      "chat.readState.set"
    ]);
    expect(API_ACTIONS.filter((action) => action.startsWith("remark."))).toEqual([
      "remark.get",
      "remark.set"
    ]);
    expect(API_ACTIONS).not.toContain("chat.delete");
    expect(API_ACTIONS.filter((action) => action.endsWith(".delete"))).toEqual([
      "moments.delete",
      "moments.comments.delete"
    ]);
    expect(ADMIN_ACTIONS).toEqual([
      "admin.seed",
      "admin.exportPage",
      "admin.importMissingPage",
      "admin.initializeProfiles"
    ]);
  });

  it("enforces Moments privacy and ownership from the authenticated session", async () => {
    const login1001 = await router.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    const login1002 = await router.handle(
      { action: "auth.login", payload: { accountId: "1002", password: "1013" } },
      "127.0.0.2"
    );
    const session1001 = valueOf(login1001, "sessionToken");
    const session1002 = valueOf(login1002, "sessionToken");

    const privatePost = await router.handle({
      action: "moments.create",
      sessionToken: session1001,
      payload: { clientMomentId: "private-1", body: "private", visibility: "SELF", authorId: "1002" }
    }, "127.0.0.1");
    expect(privatePost).toMatchObject({
      ok: true,
      data: { id: "1001_private-1", authorId: "1001", visibility: "SELF" }
    });
    await expect(router.handle({ action: "moments.list", sessionToken: session1002, payload: {} }, "127.0.0.2"))
      .resolves.toEqual({ ok: true, data: [] });
    await expect(router.handle({
      action: "moments.like",
      sessionToken: session1002,
      payload: { momentId: "1001_private-1", accountId: "1001" }
    }, "127.0.0.2")).resolves.toMatchObject({ ok: false, error: { code: "MOMENT_NOT_FOUND" } });
    await expect(router.handle({
      action: "moments.comments.create",
      sessionToken: session1002,
      payload: { momentId: "1001_private-1", clientCommentId: "hidden-comment", body: "no" }
    }, "127.0.0.2")).resolves.toMatchObject({ ok: false, error: { code: "MOMENT_NOT_FOUND" } });

    await expect(router.handle({
      action: "moments.delete",
      sessionToken: session1001,
      payload: { momentId: "1001_private-1" }
    }, "127.0.0.1")).resolves.toEqual({ ok: true, data: { deleted: true } });

    await expect(router.handle({
      action: "moments.create",
      sessionToken: session1001,
      payload: { clientMomentId: "partner-1", body: "shared", visibility: "PARTNER" }
    }, "127.0.0.1")).resolves.toMatchObject({
      ok: true,
      data: { id: "1001_partner-1", authorId: "1001", visibility: "PARTNER" }
    });
    await expect(router.handle({ action: "moments.list", sessionToken: session1002, payload: {} }, "127.0.0.2"))
      .resolves.toMatchObject({ ok: true, data: [{ id: "1001_partner-1" }] });
    await expect(router.handle({
      action: "moments.like",
      sessionToken: session1002,
      payload: { momentId: "1001_partner-1" }
    }, "127.0.0.2")).resolves.toMatchObject({
      ok: true,
      data: { id: "1001_partner-1_1002", accountId: "1002" }
    });
    await expect(router.handle({
      action: "moments.comments.create",
      sessionToken: session1002,
      payload: { momentId: "1001_partner-1", clientCommentId: "comment-1", body: "hello" }
    }, "127.0.0.2")).resolves.toMatchObject({
      ok: true,
      data: { id: "1002_comment-1", authorId: "1002" }
    });
    await expect(router.handle({ action: "moments.list", sessionToken: session1002, payload: {} }, "127.0.0.2"))
      .resolves.toMatchObject({
        ok: true,
        data: [{
          id: "1001_partner-1",
          likes: [{ accountId: "1002" }],
          comments: [{ id: "1002_comment-1", authorId: "1002" }]
        }]
      });
    await expect(router.handle({
      action: "moments.delete",
      sessionToken: session1002,
      payload: { momentId: "1001_partner-1" }
    }, "127.0.0.2")).resolves.toMatchObject({ ok: false, error: { code: "MOMENT_FORBIDDEN" } });
    await expect(router.handle({
      action: "moments.comments.delete",
      sessionToken: session1001,
      payload: { commentId: "1002_comment-1" }
    }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "COMMENT_FORBIDDEN" } });
    await expect(router.handle({
      action: "moments.comments.delete",
      sessionToken: session1002,
      payload: { commentId: "1002_comment-1" }
    }, "127.0.0.2")).resolves.toEqual({ ok: true, data: { deleted: true } });
    await expect(router.handle({
      action: "moments.unlike",
      sessionToken: session1002,
      payload: { momentId: "1001_partner-1" }
    }, "127.0.0.2")).resolves.toEqual({ ok: true, data: { unliked: true } });
    await expect(router.handle({
      action: "moments.delete",
      sessionToken: session1001,
      payload: { momentId: "1001_partner-1" }
    }, "127.0.0.1")).resolves.toEqual({ ok: true, data: { deleted: true } });
    await expect(router.handle({
      action: "moments.delete",
      sessionToken: session1001,
      payload: { momentId: "1001_partner-1" }
    }, "127.0.0.1")).resolves.toEqual({ ok: true, data: { deleted: true } });
  });

  it("protects seed and backup actions with the separate admin token", async () => {
    await expect(router.handle({
      action: "admin.seed",
      payload: { adminToken: "wrong", initialPassword: "1013" }
    }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "ADMIN_UNAUTHORIZED" } });

    await expect(router.handle({
      action: "admin.seed",
      payload: { adminToken: "admin-secret", initialPassword: "1013" }
    }, "127.0.0.1")).resolves.toMatchObject({
      ok: true,
      data: { createdAccounts: [], relationshipCreated: true }
    });
  });

  it("authenticates every admin action before parsing action-specific payloads", async () => {
    const oversizedEntries = Array.from({ length: 501 }, () => null);
    const map = vi.spyOn(oversizedEntries, "map");
    const importMissing = vi.spyOn(backups, "importMissing");

    await expect(router.handle({
      action: "admin.importMissingPage",
      payload: { adminToken: "wrong", collection: 123, entries: "malformed" }
    }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "ADMIN_UNAUTHORIZED" } });
    await expect(router.handle({
      action: "admin.importMissingPage",
      payload: { adminToken: "wrong", collection: "messages", entries: oversizedEntries }
    }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "ADMIN_UNAUTHORIZED" } });

    expect(map).not.toHaveBeenCalled();
    expect(importMissing).not.toHaveBeenCalled();
  });

  it("initializes both requested profiles through the admin action", async () => {
    await expect(router.handle({
      action: "admin.initializeProfiles",
      payload: {
        adminToken: "admin-secret",
        avatars: [
          avatarPayload("1001", INITIAL_AVATAR_BYTES["1001"]),
          avatarPayload("1002", INITIAL_AVATAR_BYTES["1002"])
        ]
      }
    }, "127.0.0.1")).resolves.toEqual({
      ok: true,
      data: { initializedAccounts: ["1001", "1002"] }
    });
  });

  it.each([
    ["an omitted avatar", [avatarPayload("1001", [1])]],
    ["a duplicated account", [avatarPayload("1001", [1]), avatarPayload("1001", [2])]],
    ["an extra account", [avatarPayload("1001", [1]), avatarPayload("1002", [2]), avatarPayload("extra", [3])]]
  ])("rejects initial profile payloads with %s", async (_label, avatars) => {
    await expect(router.handle({
      action: "admin.initializeProfiles",
      payload: { adminToken: "admin-secret", avatars }
    }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "REQUEST_INVALID" } });
  });

  it("requires JPEG and strict base64 for each initial avatar", async () => {
    await expect(router.handle({
      action: "admin.initializeProfiles",
      payload: {
        adminToken: "admin-secret",
        avatars: [
          { ...avatarPayload("1001", [1]), contentType: "image/png" },
          avatarPayload("1002", [2])
        ]
      }
    }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "AVATAR_INVALID" } });

    await expect(router.handle({
      action: "admin.initializeProfiles",
      payload: {
        adminToken: "admin-secret",
        avatars: [
          { ...avatarPayload("1001", [1]), base64: "not base64" },
          avatarPayload("1002", [2])
        ]
      }
    }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "AVATAR_INVALID" } });
  });

  it("authenticates the profile initializer before decoding avatars", async () => {
    const valid1002 = avatarPayload("1002", INITIAL_AVATAR_BYTES["1002"]);
    const bufferFrom = vi.spyOn(Buffer, "from");
    try {
      await expect(router.handle({
        action: "admin.initializeProfiles",
        payload: {
          adminToken: "wrong",
          avatars: [
            { accountId: "1001", contentType: "image/jpeg", base64: "not base64" },
            valid1002
          ]
        }
      }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "ADMIN_UNAUTHORIZED" } });
      expect(bufferFrom).not.toHaveBeenCalled();
    } finally {
      bufferFrom.mockRestore();
    }
  });

  it("rejects oversized encoded avatars before allocating decoded bytes", async () => {
    const valid1002 = avatarPayload("1002", INITIAL_AVATAR_BYTES["1002"]);
    const oversizedBase64 = "A".repeat(4 * Math.ceil((512 * 1024) / 3));
    const bufferFrom = vi.spyOn(Buffer, "from");
    try {
      await expect(router.handle({
        action: "admin.initializeProfiles",
        payload: {
          adminToken: "admin-secret",
          avatars: [
            { accountId: "1001", contentType: "image/jpeg", base64: oversizedBase64 },
            valid1002
          ]
        }
      }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "AVATAR_INVALID" } });
      expect(bufferFrom).not.toHaveBeenCalled();
    } finally {
      bufferFrom.mockRestore();
    }
  });

  it("rejects Wenli actions without a service or with an invalid session, and keeps them out of the pet allowlist", async () => {
    // 未配置问理服务时：先按会话鉴权，再在 switch 里给出明确的不可用错误。
    await expect(router.handle({
      action: "wenli.kick",
      sessionToken: "bogus",
      payload: { sourceMessageId: "1001_m-1" }
    }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "SESSION_INVALID" } });

    const login = await router.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    const sessionToken = valueOf(login, "sessionToken");
    await expect(router.handle({
      action: "wenli.kick",
      sessionToken,
      payload: { sourceMessageId: "1001_m-1" }
    }, "127.0.0.1")).resolves.toEqual({
      ok: false,
      error: { code: "WENLI_UNAVAILABLE", message: "问理暂时不可用" }
    });
    await expect(router.handle({
      action: "wenli.sweep",
      sessionToken,
      payload: { limit: 2 }
    }, "127.0.0.1")).resolves.toEqual({
      ok: false,
      error: { code: "WENLI_UNAVAILABLE", message: "问理暂时不可用" }
    });

    // 宠物会话不在白名单里，直接 PET_READONLY。
    const petLogin = await router.handle(
      { action: "pet.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.2"
    );
    const petToken = valueOf(petLogin, "sessionToken");
    await expect(router.handle({
      action: "wenli.kick",
      sessionToken: petToken,
      payload: { sourceMessageId: "1001_m-1" }
    }, "127.0.0.2")).resolves.toMatchObject({ ok: false, error: { code: "PET_READONLY" } });
  });

  it("forwards Wenli kick and sweep to the configured service", async () => {
    const messages = new MemoryMessageStore();
    const jobs = new MemoryWenliJobExecutionStore(messages);
    const source: MessageRecord = {
      id: "1001_mention",
      relationshipId: "couple",
      senderId: "1001",
      recipientId: "1002",
      clientMessageId: "mention",
      body: "@问理 在吗",
      createdAt: "2026-08-06T00:00:00.000Z"
    };
    await messages.appendIfAbsent(source);
    await jobs.createIfAbsent({
      id: source.id,
      type: "mention",
      requesterId: "1001",
      sourceMessageId: source.id,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: "2026-08-06T00:00:00.000Z",
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z"
    });
    const generator = { generate: async () => ({ reply: "问理的回答", memoryUpdate: null }) };
    const wenli = new WenliService(
      jobs,
      new WenliJobWorker({ store: jobs, generator, clock: () => new Date("2026-08-06T00:00:00.000Z") }),
      undefined,
      () => new Date("2026-08-06T00:00:00.000Z")
    );
    const wenliRouter = new ApiRouter(
      new AuthService(users, new MemoryLoginAttemptStore(), new MemoryPetSessionStore()),
      new ChatService(messages, () => new Date("2026-08-06T00:00:00.000Z")),
      new ProfileService(users, new MemoryAvatarStore()),
      new MomentService(new MemoryMomentStore(), () => new Date("2026-08-07T00:00:00.000Z")),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      wenli
    );
    const login = await wenliRouter.handle(
      { action: "auth.login", payload: { accountId: "1001", password: "1013" } },
      "127.0.0.1"
    );
    const sessionToken = valueOf(login, "sessionToken");

    await expect(wenliRouter.handle({
      action: "wenli.kick",
      sessionToken,
      payload: { sourceMessageId: source.id }
    }, "127.0.0.1")).resolves.toEqual({
      ok: true,
      data: { processed: true, messageId: deterministicWenliReplyId(source.id) }
    });
    await expect(messages.get(deterministicWenliReplyId(source.id))).resolves.toMatchObject({ body: "问理的回答" });

    await expect(wenliRouter.handle({
      action: "wenli.sweep",
      sessionToken,
      payload: { limit: 2 }
    }, "127.0.0.1")).resolves.toEqual({ ok: true, data: { processed: 0 } });
    await expect(wenliRouter.handle({
      action: "wenli.sweep",
      sessionToken,
      payload: { limit: 9 }
    }, "127.0.0.1")).resolves.toMatchObject({ ok: false, error: { code: "PAGE_SIZE_INVALID" } });
  });

  async function user(accountId: AccountId): Promise<UserRecord> {
    return {
      accountId,
      ...INITIAL_PROFILES[accountId],
      avatarKey: null,
      profileInitializedVersion: 0,
      passwordHash: await hashPassword("1013"),
      sessionHash: null,
      sessionVersion: 0,
      updatedAt: "2026-08-06T00:00:00.000Z"
    };
  }
});

function valueOf(response: Awaited<ReturnType<ApiRouter["handle"]>>, key: string): string {
  if (!response.ok || typeof response.data !== "object" || response.data === null) {
    throw new Error("expected successful object response");
  }
  const value = (response.data as Record<string, unknown>)[key];
  if (typeof value !== "string") {
    throw new Error(`expected ${key} to be a string`);
  }
  return value;
}

function avatarPayload(accountId: string, bytes: number[] | Uint8Array): {
  accountId: string;
  contentType: string;
  base64: string;
} {
  return {
    accountId,
    contentType: "image/jpeg",
    base64: Buffer.from(bytes).toString("base64")
  };
}
