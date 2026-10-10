import type { AccountId, PushRegistrationRecord } from "../domain/contracts.js";
import type { PushRegistrationStore } from "../ports/stores.js";

const FIXED_ACCOUNT_IDS: readonly AccountId[] = ["1001", "1002"];

export interface JpushHttp {
  sendPush(payload: unknown): Promise<void>;
}

/**
 * 推送服务：设备注册/注销 + 优先按极光 registration_id 精确推送。
 * 凭据缺失时 register/unregister 仍可记录设备，pushTo 为 no-op（不影响消息发送）。
 */
export class PushService {
  constructor(
    private readonly registrations: PushRegistrationStore,
    private readonly appKey: string,
    private readonly masterSecret: string,
    private readonly http: JpushHttp,
    private readonly clock: () => Date = () => new Date()
  ) {}

  isEnabled(): boolean {
    return this.appKey !== "" && this.masterSecret !== "";
  }

  async register(accountId: AccountId, registrationId: string): Promise<PushRegistrationRecord> {
    const record: PushRegistrationRecord = {
      id: accountId,
      accountId,
      registrationId,
      platform: "android",
      updatedAt: this.clock().toISOString()
    };
    return this.registrations.save(record);
  }

  async unregister(accountId: AccountId): Promise<void> {
    await this.registrations.remove(accountId);
  }

  async pushTo(
    recipientId: AccountId,
    alert: string,
    messageId?: string,
    messageCreatedAt?: string
  ): Promise<void> {
    if (!this.isEnabled()) return;
    const registration = await this.registrations.get(recipientId);
    // 没有当前设备的 registration_id 记录（例如已退出登录）时直接不发送；
    // 不再回退 alias，避免向已退出的设备推送。
    if (!registration) return;
    await this.send(registration.registrationId, recipientId, alert, messageId, messageCreatedAt);
  }

  /**
   * 一次给多个账号推送（小Q回复要同时提醒双方）。
   * 每个账号独立按 registration_id 判定：没有记录的设备跳过，不回退 alias。
   */
  async pushToMany(
    recipientIds: readonly AccountId[],
    alert: string,
    messageId?: string,
    messageCreatedAt?: string
  ): Promise<void> {
    if (!this.isEnabled()) return;
    await Promise.all(recipientIds.map((recipientId) => this.pushTo(recipientId, alert, messageId, messageCreatedAt)));
  }

  /** 小Q回复：推给固定双方，并带唤醒信号让前台立刻同步。 */
  async pushWenli(alert: string, messageId?: string, messageCreatedAt?: string): Promise<void> {
    await this.pushToMany(FIXED_ACCOUNT_IDS, alert, messageId, messageCreatedAt);
  }

  private async send(
    registrationId: string,
    recipientId: AccountId,
    alert: string,
    messageId?: string,
    messageCreatedAt?: string
  ): Promise<void> {
    const cursor = messageId !== undefined && messageCreatedAt !== undefined
      ? { message_id: messageId, message_created_at: messageCreatedAt }
      : messageId === undefined ? {} : { message_id: messageId };
    const extras = {
      type: "chat",
      conversation_id: "couple",
      recipient_id: recipientId,
      ...cursor
    };
    await this.http.sendPush({
      platform: "android",
      audience: { registration_id: [registrationId] },
      notification: { android: { alert, extras } },
      // 自定义消息：App 在前台时极光直接下发、不弹系统通知，客户端收到后立刻同步一次，
      // 把收消息延迟从最长 15 秒压到约 1 秒。内容只是唤醒信号，不携带聊天正文。
      message: {
        msg_content: JSON.stringify({
          type: "chat",
          conversation_id: "couple",
          recipient_id: recipientId,
          ...cursor
        })
      },
      // 聊天记录由客户端同步；推送只承担实时提醒，避免设备重连时把数小时前的消息显示成“现在”。
      options: { time_to_live: 300 }
    });
  }
}

/** 极光 REST API 客户端（v3 push 接口）。 */
export function createJpushHttp(appKey: string, masterSecret: string): JpushHttp {
  return {
    async sendPush(payload: unknown): Promise<void> {
      const auth = "Basic " + Buffer.from(`${appKey}:${masterSecret}`).toString("base64");
      const response = await fetch("https://api.jpush.cn/v3/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`JPush request failed with status ${response.status}`);
      }
    }
  };
}
