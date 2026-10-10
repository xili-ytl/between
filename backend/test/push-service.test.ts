import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPushRegistrationStore } from "../src/adapters/memory-stores.js";
import { PushService, type JpushHttp } from "../src/services/push-service.js";

describe("PushService", () => {
  let store: MemoryPushRegistrationStore;
  let sent: unknown[];
  let http: JpushHttp;
  let service: PushService;

  beforeEach(() => {
    store = new MemoryPushRegistrationStore();
    sent = [];
    http = { sendPush: vi.fn(async (payload: unknown) => { sent.push(payload); }) };
    service = new PushService(store, "app-key", "master-secret", http, () => new Date("2026-08-09T00:00:00.000Z"));
  });

  it("registers one device per account and unregisters", async () => {
    const record = await service.register("1001", "registration-1");
    expect(record).toMatchObject({ accountId: "1001", registrationId: "registration-1", platform: "android" });
    await expect(store.get("1001")).resolves.toMatchObject({ registrationId: "registration-1" });

    await service.unregister("1001");
    await expect(store.get("1001")).resolves.toBeNull();
  });

 it("pushes to the recipient registration id when the device is registered", async () => {
   await service.register("1002", "registration-1002");
    await service.pushTo("1002", "你好", "1002_message-1", "2026-08-09T00:00:01.000Z");
    expect(sent).toEqual([
      {
        platform: "android",
        audience: { registration_id: ["registration-1002"] },
        notification: {
          android: {
            alert: "你好",
            extras: {
              type: "chat",
              conversation_id: "couple",
              recipient_id: "1002",
              message_id: "1002_message-1",
              message_created_at: "2026-08-09T00:00:01.000Z"
            }
          }
        },
        // 前台自定义消息只作唤醒信号，不携带聊天正文。
        message: {
          msg_content: JSON.stringify({
            type: "chat",
            conversation_id: "couple",
            recipient_id: "1002",
            message_id: "1002_message-1",
            message_created_at: "2026-08-09T00:00:01.000Z"
          })
        },
        options: { time_to_live: 300 }
      }
    ]);
  });

  it("does not send when the recipient has no registration record", async () => {
    // 已退出登录的设备不应再收到推送；没有 registration_id 记录时不再回退 alias。
    await service.pushTo("1002", "你好");
    expect(sent).toEqual([]);
    expect(http.sendPush).not.toHaveBeenCalled();
  });

  it("keeps the legacy id-only fallback when a message timestamp is unavailable", async () => {
    await service.register("1002", "registration-1002");
    await service.pushTo("1002", "你好", "1002_message-legacy");

    const payload = sent[0] as {
      notification: { android: { extras: Record<string, string> } };
      message: { msg_content: string };
    };
    expect(payload.notification.android.extras).toEqual({
      type: "chat",
      conversation_id: "couple",
      recipient_id: "1002",
      message_id: "1002_message-legacy"
    });
    expect(JSON.parse(payload.message.msg_content)).toEqual(payload.notification.android.extras);
  });

  it("is a no-op push when credentials are missing", async () => {
    const disabled = new PushService(store, "", "", http);
    expect(disabled.isEnabled()).toBe(false);
    await disabled.pushTo("1002", "你好");
    expect(sent).toEqual([]);
    // 注册仍可记录设备
    await expect(disabled.register("1001", "registration-2")).resolves.toMatchObject({
      registrationId: "registration-2"
    });
  });

  it("pushes one request to every registered recipient and skips unregistered ones", async () => {
    // 小Q回复要给双方都推；已退出登录（无 registration_id 记录）的一方跳过，不回退 alias。
    await service.register("1001", "registration-1001");
    await service.pushToMany(["1001", "1002"], "小Q回复");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      audience: { registration_id: ["registration-1001"] },
      notification: {
        android: {
          alert: "小Q回复",
          extras: { type: "chat", conversation_id: "couple", recipient_id: "1001" }
        }
      }
    });
    const content = JSON.parse((sent[0] as { message: { msg_content: string } }).message.msg_content);
    expect(content).toEqual({ type: "chat", conversation_id: "couple", recipient_id: "1001" });
  });

  it("pushes to both recipients when both devices are registered", async () => {
    await service.register("1001", "registration-1001");
    await service.register("1002", "registration-1002");
    await service.pushToMany(["1001", "1002"], "小Q回复");

    expect(sent).toHaveLength(2);
    const audience = sent.flatMap((payload) => (payload as { audience: { registration_id: string[] } })
      .audience.registration_id);
    expect(audience.sort()).toEqual(["registration-1001", "registration-1002"]);
  });

  it("does not send anything for an empty or fully unregistered recipient list", async () => {
    await service.pushToMany([], "无人接收");
    await service.pushToMany(["1001", "1002"], "都退出了");
    expect(sent).toEqual([]);
    expect(http.sendPush).not.toHaveBeenCalled();
  });

  it("pushWenli wakes up both accounts", async () => {
    await service.register("1001", "registration-1001");
    await service.register("1002", "registration-1002");
    await service.pushWenli("[图片]");

    expect(sent).toHaveLength(2);
    for (const payload of sent) {
      expect(payload).toMatchObject({
        notification: { android: { alert: "[图片]" } }
      });
      const content = JSON.parse((payload as { message: { msg_content: string } }).message.msg_content);
      expect(content).toMatchObject({ type: "chat", conversation_id: "couple" });
      expect(["1001", "1002"]).toContain(content.recipient_id);
    }
  });
});
