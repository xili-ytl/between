import { isFixedAccountId } from "../domain/contracts.js";
import type { AccountId, AvatarObject, ImageMessageFields, MessageCursor, PetAction, UserRecord } from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import type { AuthService } from "../services/auth-service.js";
import type { PetService } from "../services/pet-service.js";
import {
  PET_AI_TASKS,
  PET_SPEAK_PROMPTS,
  type PetAiService,
  type PetAiTask,
  type PetSpeakPrompt
} from "../services/pet-ai-service.js";
import type { ChatService } from "../services/chat-service.js";
import type { ImageService } from "../services/image-service.js";
import type { ProfileService } from "../services/profile-service.js";
import type { AdminService } from "../services/admin-service.js";
import type { MomentService } from "../services/moment-service.js";
import type { ReleaseService } from "../services/release-service.js";
import type { RemarkService } from "../services/remark-service.js";
import type { PushService } from "../services/push-service.js";
import type { ReadStateService } from "../services/read-state-service.js";
import type { StoredDocument } from "../ports/stores.js";
import type { WenliService } from "../services/wenli-service.js";

export const API_ACTIONS = [
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
] as const;

export const ADMIN_ACTIONS = [
  "admin.seed",
  "admin.exportPage",
  "admin.importMissingPage",
  "admin.initializeProfiles"
] as const;

type ApiAction = (typeof API_ACTIONS)[number];
type AdminAction = (typeof ADMIN_ACTIONS)[number];
type AnyAction = ApiAction | AdminAction;

/** pet 会话允许的动作：只读你们的聊天/朋友圈/资料 + 操作宠物自身状态；聊天写、朋友圈写、账号操作一律拒绝。 */
const PET_ALLOWED_ACTIONS = new Set<string>([
  "system.version",
  "profile.get",
  "chat.after",
  "chat.before",
  "moments.list",
  "pet.get",
  "pet.act",
  "pet.ai.chat",
  "pet.ai.speak",
  "pet.ai.task"
]);

export interface ApiRequest {
  action?: unknown;
  sessionToken?: unknown;
  payload?: unknown;
}

export type ApiResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } };

export class ApiRouter {
  constructor(
    private readonly auth: AuthService,
    private readonly chat: ChatService,
    private readonly profiles: ProfileService,
    private readonly moments: MomentService,
    private readonly admin?: AdminService,
    private readonly releases?: Pick<ReleaseService, "latest" | "petLatest">,
    private readonly remarks?: RemarkService,
    private readonly images?: ImageService,
    private readonly readStates?: ReadStateService,
    private readonly push?: PushService,
    private readonly pets?: PetService,
    private readonly petAi?: PetAiService,
    private readonly wenli?: WenliService
  ) {}

  async handle(request: ApiRequest, source: string): Promise<ApiResponse> {
    try {
      const action = parseAction(request.action);
      const payload = asRecord(request.payload);
      if (isAdminAction(action)) {
        if (!this.admin) throw new AppError("ADMIN_DISABLED", "管理操作未启用");
        const token = requiredString(payload, "adminToken");
        this.admin.authorize(token);
        if (action === "admin.seed") {
          return success(await this.admin.seed(token, requiredString(payload, "initialPassword")));
        }
        if (action === "admin.exportPage") {
          return success(await this.admin.exportPage(
            token,
            requiredString(payload, "collection"),
            optionalString(payload.afterId),
            typeof payload.limit === "number" ? payload.limit : 500
          ));
        }
        if (action === "admin.initializeProfiles") {
          return success(await this.admin.initializeProfiles(token, initialAvatars(payload.avatars)));
        }
        return success(await this.admin.importMissingPage(
          token,
          requiredString(payload, "collection"),
          storedDocuments(payload.entries)
        ));
      }
      if (action === "system.health") {
        return success({ status: "ok" });
      }
      if (action === "system.version") {
        if (!this.releases) throw new AppError("RELEASE_UNAVAILABLE", "暂时无法检查更新");
        return success(await this.releases.latest());
      }
      if (action === "system.petVersion") {
        if (!this.releases) throw new AppError("RELEASE_UNAVAILABLE", "暂时无法检查更新");
        return success(await this.releases.petLatest());
      }
      if (action === "auth.login") {
        return success(await this.auth.login(requiredString(payload, "accountId"), requiredString(payload, "password"), source));
      }
      if (action === "pet.login") {
        // 桌面端 Q 宠：颁发独立只读会话，不轮换手机主会话。
        return success(await this.auth.petLogin(requiredString(payload, "accountId"), requiredString(payload, "password"), source));
      }

      const sessionToken = typeof request.sessionToken === "string" ? request.sessionToken : "";
      if (action === "pet.logout") {
        await this.auth.petLogout(sessionToken);
        return success({ loggedOut: true });
      }
      if (action === "auth.logout") {
        await this.auth.logout(sessionToken);
        return success({ loggedOut: true });
      }
      if (action === "auth.changePassword") {
        return success(await this.auth.changePassword(
          sessionToken,
          requiredString(payload, "currentPassword"),
          requiredString(payload, "replacementPassword")
        ));
      }

      const authenticated = await this.auth.authenticateAny(sessionToken);
      if (authenticated.role === "pet" && !PET_ALLOWED_ACTIONS.has(action)) {
        throw new AppError("PET_READONLY", "宠物会话不允许执行此操作");
      }
      const user = authenticated.user;
      switch (action) {
        case "profile.get":
          return success(await Promise.all((await this.profiles.getPair()).map((profile) => publicProfile(profile, this.profiles))));
        case "profile.update":
          return success(await publicProfile(await this.profiles.updateDisplayName(
            user.accountId,
            requiredString(payload, "displayName")
          ), this.profiles));
        case "profile.updateAvatar":
          return success(await publicProfile(await this.profiles.updateAvatar(
            user.accountId,
            requiredString(payload, "contentType"),
            decodeBase64(requiredString(payload, "base64"))
          ), this.profiles));
        case "chat.send": {
          const message = await this.chat.send(
            user.accountId,
            requiredString(payload, "clientMessageId"),
            requiredString(payload, "body"),
            optionalString(payload.replyToMessageId) ?? undefined,
            imageMessageFields(payload)
          );
          // 消息已经落库；推送改为 fire-and-forget，发送接口不等待外部推送，避免发送卡顿。
          // 推送失败不回滚消息，也不影响发送接口成功。
          if (this.push) {
            const alert = message.type === "image" ? "[图片]" : message.body;
            void this.push.pushTo(message.recipientId, alert, message.id, message.createdAt).catch(() => undefined);
          }
          return success(message);
        }
        case "chat.after":
          return success(await this.chat.after(optionalCursor(payload.cursor), pageSize(payload.limit)));
        case "chat.before":
          return success(await this.chat.before(optionalCursor(payload.cursor), pageSize(payload.limit)));
        case "chat.imageUploadCredential":
          if (!this.images) throw new AppError("IMAGE_UNAVAILABLE", "暂时无法上传图片");
          return success(await this.images.uploadCredential(
            user.accountId,
            requiredString(payload, "clientMessageId"),
            requiredString(payload, "imageMimeType")
          ));
        case "chat.imageUrl":
          if (!this.images) throw new AppError("IMAGE_UNAVAILABLE", "暂时无法读取图片");
          return success({ url: await this.images.imageUrl(requiredString(payload, "imageFileId")) });
        case "chat.readState.get":
          if (!this.readStates) throw new AppError("READ_STATE_UNAVAILABLE", "暂时无法读取已读状态");
          return success(await this.readStates.get(user.accountId));
        case "chat.readState.set": {
          if (!this.readStates) throw new AppError("READ_STATE_UNAVAILABLE", "暂时无法更新已读状态");
          const messageId = optionalString(payload.lastReadMessageId);
          const messageCursor = optionalString(payload.lastReadMessageCreatedAt);
          const receiptMessageId = optionalString(payload.readReceiptMessageId);
          const receiptMessageCursor = optionalString(payload.readReceiptMessageCreatedAt);
          const seenMoment = optionalString(payload.lastSeenMomentAt);
          return success(await this.readStates.set(user.accountId, {
            ...(messageId === null ? {} : { lastReadMessageId: messageId }),
            ...(messageCursor === null ? {} : { lastReadMessageCreatedAt: messageCursor }),
            ...(receiptMessageId === null ? {} : { readReceiptMessageId: receiptMessageId }),
            ...(receiptMessageCursor === null ? {} : { readReceiptMessageCreatedAt: receiptMessageCursor }),
            ...(seenMoment === null ? {} : { lastSeenMomentAt: seenMoment })
          }));
        }
        case "push.register":
          if (!this.push) throw new AppError("PUSH_UNAVAILABLE", "推送服务未启用");
          return success(await this.push.register(
            user.accountId,
            requiredString(payload, "registrationId")
          ));
        case "push.unregister":
          if (!this.push) throw new AppError("PUSH_UNAVAILABLE", "推送服务未启用");
          await this.push.unregister(user.accountId);
          return success({ unregistered: true });
        case "remark.get":
          if (!this.remarks) throw new AppError("REMARK_UNAVAILABLE", "暂时无法读取备注");
          return success(await this.remarks.get(user.accountId, fixedAccountId(payload, "targetId")));
        case "remark.set":
          if (!this.remarks) throw new AppError("REMARK_UNAVAILABLE", "暂时无法保存备注");
          return success(await this.remarks.set(
            user.accountId,
            fixedAccountId(payload, "targetId"),
            requiredString(payload, "remark")
          ));
        case "moments.list":
          return success(await this.moments.list(user.accountId));
        case "moments.create":
          return success(await this.moments.create(
            user.accountId,
            requiredString(payload, "clientMomentId"),
            requiredString(payload, "body"),
            requiredString(payload, "visibility"),
            imageMessageFields(payload)
          ));
        case "moments.imageUploadCredential":
          if (!this.images) throw new AppError("IMAGE_UNAVAILABLE", "暂时无法上传图片");
          return success(await this.images.uploadCredential(
            user.accountId,
            requiredString(payload, "clientMomentId"),
            requiredString(payload, "imageMimeType"),
            "moments-images"
          ));
        case "moments.delete":
          return success(await this.moments.delete(user.accountId, requiredString(payload, "momentId")));
        case "moments.like":
          return success(await this.moments.like(user.accountId, requiredString(payload, "momentId")));
        case "moments.unlike":
          return success(await this.moments.unlike(user.accountId, requiredString(payload, "momentId")));
        case "moments.comments.create":
          return success(await this.moments.comment(
            user.accountId,
            requiredString(payload, "momentId"),
            requiredString(payload, "clientCommentId"),
            requiredString(payload, "body"),
            optionalString(payload.replyToCommentId) ?? undefined
          ));
        case "moments.comments.delete":
          return success(await this.moments.deleteComment(user.accountId, requiredString(payload, "commentId")));
        case "pet.ai.chat":
          if (!this.petAi) throw new AppError("AI_UNAVAILABLE", "AI 服务暂不可用");
          return success(await this.petAi.chat(
            user.accountId,
            requiredString(payload, "userText"),
            payload.history ?? []
          ));
        case "pet.ai.speak":
          if (!this.petAi) throw new AppError("AI_UNAVAILABLE", "AI 服务暂不可用");
          return success(await this.petAi.speak(
            user.accountId,
            petSpeakPromptValue(payload.promptType),
            asRecord(payload.context)
          ));
        case "pet.ai.task":
          if (!this.petAi) throw new AppError("AI_UNAVAILABLE", "AI 服务暂不可用");
          return success(await this.petAi.task(
            user.accountId,
            petAiTaskValue(payload.taskType),
            asRecord(payload.input)
          ));
        case "pet.get":
          if (!this.pets) throw new AppError("PET_UNAVAILABLE", "暂时无法读取宠物状态");
          return success(await this.pets.getState());
        case "pet.act": {
          if (!this.pets) throw new AppError("PET_UNAVAILABLE", "暂时无法操作宠物");
          return success(await this.pets.act(
            user.accountId,
            petActionValue(payload.action),
            typeof payload.amount === "number" ? payload.amount : undefined
          ));
        }
        case "wenli.kick": {
          if (!this.wenli) throw new AppError("WENLI_UNAVAILABLE", "小Q暂时不可用");
          return success(await this.wenli.kick(
            user.accountId,
            requiredString(payload, "sourceMessageId")
          ));
        }
        case "wenli.sweep": {
          if (!this.wenli) throw new AppError("WENLI_UNAVAILABLE", "小Q暂时不可用");
          return success(await this.wenli.sweep(typeof payload.limit === "number" ? payload.limit : 2));
        }
        default:
          throw new AppError("ACTION_INVALID", "不支持的操作");
      }
    } catch (error) {
      if (error instanceof AppError) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      return { ok: false, error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" } };
    }
  }
}

function parseAction(value: unknown): AnyAction {
  if (typeof value === "string" && (
    API_ACTIONS.includes(value as ApiAction) || ADMIN_ACTIONS.includes(value as AdminAction)
  )) {
    return value as AnyAction;
  }
  throw new AppError("ACTION_INVALID", "不支持的操作");
}

function isAdminAction(action: AnyAction): action is AdminAction {
  return ADMIN_ACTIONS.includes(action as AdminAction);
}

function success(data: unknown): ApiResponse {
  return { ok: true, data };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new AppError("REQUEST_INVALID", "请求参数无效");
  }
  return value;
}

function fixedAccountId(record: Record<string, unknown>, key: string): AccountId {
  const value = requiredString(record, key);
  if (!isFixedAccountId(value)) throw new AppError("REQUEST_INVALID", "请求参数无效");
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new AppError("REQUEST_INVALID", "请求参数无效");
  return value;
}

function imageMessageFields(record: Record<string, unknown>): ImageMessageFields | undefined {
  const type = record.type;
  if (type === undefined || type === null) return undefined;
  if (type !== "image") throw new AppError("REQUEST_INVALID", "请求参数无效");
  const imageMimeType = requiredString(record, "imageMimeType");
  if (imageMimeType !== "image/jpeg" && imageMimeType !== "image/png" && imageMimeType !== "image/webp") {
    throw new AppError("REQUEST_INVALID", "请求参数无效");
  }
  return {
    imageFileId: requiredString(record, "imageFileId"),
    imageMimeType,
    ...(record.imageWidth === undefined ? {} : { imageWidth: positiveInteger(record.imageWidth, "imageWidth") }),
    ...(record.imageHeight === undefined ? {} : { imageHeight: positiveInteger(record.imageHeight, "imageHeight") })
  };
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new AppError("REQUEST_INVALID", "请求参数无效");
  }
  return value;
}

function petActionValue(value: unknown): PetAction {
  if (value !== "feed" && value !== "bath" && value !== "play" && value !== "heal") {
    throw new AppError("REQUEST_INVALID", "请求参数无效");
  }
  return value;
}

function petSpeakPromptValue(value: unknown): PetSpeakPrompt {
  if (typeof value !== "string" || !PET_SPEAK_PROMPTS.includes(value as PetSpeakPrompt)) {
    throw new AppError("REQUEST_INVALID", "请求参数无效");
  }
  return value as PetSpeakPrompt;
}

function petAiTaskValue(value: unknown): PetAiTask {
  if (typeof value !== "string" || !PET_AI_TASKS.includes(value as PetAiTask)) {
    throw new AppError("REQUEST_INVALID", "请求参数无效");
  }
  return value as PetAiTask;
}

function storedDocuments(value: unknown): StoredDocument[] {
  if (!Array.isArray(value)) throw new AppError("REQUEST_INVALID", "请求参数无效");
  return value.map((entry) => {
    const record = asRecord(entry);
    return { id: requiredString(record, "id"), data: asRecord(record.data) };
  });
}

function initialAvatars(value: unknown): Record<AccountId, AvatarObject> {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new AppError("REQUEST_INVALID", "请求参数无效");
  }

  const parsed = new Map<AccountId, AvatarObject>();
  for (const valueEntry of value) {
    const entry = asRecord(valueEntry);
    const accountId = requiredString(entry, "accountId");
    if (!isFixedAccountId(accountId) || parsed.has(accountId)) {
      throw new AppError("REQUEST_INVALID", "请求参数无效");
    }
    if (requiredString(entry, "contentType") !== "image/jpeg") {
      throw new AppError("AVATAR_INVALID", "初始头像须为 JPEG 图片");
    }
    parsed.set(accountId, {
      contentType: "image/jpeg",
      bytes: decodeBase64(requiredString(entry, "base64"))
    });
  }

  const avatar1001 = parsed.get("1001");
  const avatar1002 = parsed.get("1002");
  if (!avatar1001 || !avatar1002) throw new AppError("REQUEST_INVALID", "请求参数无效");
  return { "1001": avatar1001, "1002": avatar1002 };
}

function pageSize(value: unknown): number {
  return typeof value === "number" ? value : 50;
}

function optionalCursor(value: unknown): MessageCursor | null {
  if (value === null || value === undefined) return null;
  const cursor = asRecord(value);
  return {
    createdAt: requiredString(cursor, "createdAt"),
    id: requiredString(cursor, "id")
  };
}

function decodeBase64(value: string): Uint8Array {
  const maxAvatarBytes = 512 * 1024;
  const maxEncodedAvatarLength = 4 * Math.ceil(maxAvatarBytes / 3);
  if (value.length > maxEncodedAvatarLength ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new AppError("AVATAR_INVALID", "头像数据无效");
  }
  const paddingBytes = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if ((value.length / 4) * 3 - paddingBytes > maxAvatarBytes) {
    throw new AppError("AVATAR_INVALID", "头像数据无效");
  }
  return Buffer.from(value, "base64");
}

async function publicProfile(user: UserRecord, profiles: ProfileService): Promise<{
  accountId: UserRecord["accountId"];
  displayName: string;
  gender: UserRecord["gender"];
  avatarUrl: string | null;
  updatedAt: string;
}> {
  return {
    accountId: user.accountId,
    displayName: user.displayName,
    gender: user.gender,
    avatarUrl: await profiles.avatarUrl(user.avatarKey),
    updatedAt: user.updatedAt
  };
}
