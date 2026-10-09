export const FIXED_ACCOUNT_IDS = ["1001", "1002"] as const;

export type AccountId = (typeof FIXED_ACCOUNT_IDS)[number];

export const WENLI_SENDER_ID = "wenli" as const;

export type MessageSenderId = AccountId | typeof WENLI_SENDER_ID;

export type Gender = "女" | "男";

export const INITIAL_PROFILES = {
  "1001": { displayName: "示例乙", gender: "女" },
  "1002": { displayName: "示例甲", gender: "男" }
} as const satisfies Record<AccountId, { displayName: string; gender: Gender }>;

export interface UserRecord {
  accountId: AccountId;
  displayName: string;
  gender: Gender;
  avatarKey: string | null;
  profileInitializedVersion: number;
  passwordHash: string;
  sessionHash: string | null;
  sessionVersion: number;
  updatedAt: string;
}

export interface SessionResult {
  accountId: AccountId;
  displayName: string;
  avatarKey: string | null;
  sessionToken: string;
  sessionVersion: number;
}

export type MessageType = "text" | "image";

/** 图片消息的 body 占位文案：旧版本无法显示图片时回退为此文本。 */
export const IMAGE_MESSAGE_PLACEHOLDER = "[该消息新版本可见]";

export type ImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export const IMAGE_EXTENSION: Record<ImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export function isImageMimeType(value: unknown): value is ImageMimeType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

export interface ImageMessageFields {
  imageFileId: string;
  imageMimeType: ImageMimeType;
  imageWidth?: number;
  imageHeight?: number;
}

export interface MessageRecord {
  id: string;
  relationshipId: "couple";
  senderId: MessageSenderId;
  recipientId: AccountId;
  clientMessageId: string;
  body: string;
  replyToMessageId?: string;
  sourceMessageId?: string;
  type?: MessageType;
  imageFileId?: string;
  imageMimeType?: ImageMimeType;
  imageWidth?: number;
  imageHeight?: number;
  createdAt: string;
}

export interface RelationshipRecord {
  id: "couple";
  memberIds: ["1001", "1002"];
  createdAt: string;
}

export interface MessageCursor {
  createdAt: string;
  id: string;
}

export function compareMessageCursors(left: MessageCursor, right: MessageCursor): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export interface MessagePage {
  items: MessageRecord[];
  nextCursor: MessageCursor | null;
}

export interface ContactRemarkRecord {
  ownerId: AccountId;
  targetId: AccountId;
  remark: string;
  updatedAt: string;
}

export type MomentVisibility = "PARTNER" | "SELF";

export interface MomentRecord {
  id: string;
  authorId: AccountId;
  clientMomentId: string;
  body: string;
  visibility: MomentVisibility;
  imageFileId?: string;
  imageMimeType?: string;
  imageWidth?: number;
  imageHeight?: number;
  createdAt: string;
  deleting: boolean;
}

export interface MomentLikeRecord {
  id: string;
  momentId: string;
  accountId: AccountId;
  createdAt: string;
}

export interface MomentCommentRecord {
  id: string;
  momentId: string;
  authorId: AccountId;
  clientCommentId: string;
  body: string;
  /** 回复的评论 id；缺省表示直接评论动态本身（旧评论兼容） */
  replyToCommentId?: string;
  createdAt: string;
}

export interface MomentView extends Omit<MomentRecord, "deleting"> {
  likes: MomentLikeRecord[];
  comments: MomentCommentRecord[];
}

export interface AvatarObject {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
}

/** 每个账号的聊天/朋友圈已读游标（单调向前推进） */
export interface ReadStateRecord {
  accountId: AccountId;
  lastReadMessageId?: string;
  lastReadMessageCreatedAt?: string;
  /** 独立于旧未读红点的、由本人实际阅读位置推进的服务器回执游标。 */
  readReceiptMessageId?: string;
  readReceiptMessageCreatedAt?: string;
  lastSeenMomentAt?: string;
  updatedAt: string;
}

/** 只在读取接口返回的对方必要字段，不落回对方文档。 */
export interface ReadStateView extends ReadStateRecord {
  partnerReadReceiptMessageId?: string;
  partnerReadReceiptMessageCreatedAt?: string;
}

/** 每个账号当前有效设备的推送注册（单设备登录，id=accountId）。临时凭据，不参与备份。 */
export interface PushRegistrationRecord {
  id: AccountId;
  accountId: AccountId;
  registrationId: string;
  platform: string;
  updatedAt: string;
}

/** 电脑端 Q 宠的独立只读会话（id=accountId，单设备一个，不轮换主会话）。临时凭据，不参与备份。 */
export interface PetSessionRecord {
  id: AccountId;
  accountId: AccountId;
  sessionHash: string;
  expiresAt: string;
  updatedAt: string;
}

/** pet.login 返回给桌面端 Q 宠的会话结果（与主会话完全隔离，手机不受影响）。 */
export interface PetSessionResult {
  accountId: AccountId;
  displayName: string;
  avatarKey: string | null;
  sessionToken: string;
}

/** 情侣共同培养的 Q 宠共享状态（云端唯一真相，id=couple，两人各自电脑看到的都是它）。 */
export interface PetStateRecord {
  id: "couple";
  name: string;
  host: string;
  sex: "公" | "母";
  growth: number;
  hunger: number;
  clean: number;
  health: number;
  mood: number;
  yb: number;
  intel: number;
  charm: number;
  strong: number;
  birthDay: string;
  level: number;
  updatedAt: string;
  updatedBy: AccountId;
}

export type PetAction = "feed" | "bath" | "play" | "heal";

export interface PetStateView {
  name: string;
  host: string;
  sex: "公" | "母";
  level: number;
  growth: number;
  hunger: number;
  hunger_max: number;
  clean: number;
  clean_max: number;
  health: number;
  mood: number;
  mood_max: number;
  yb: number;
  intel: number;
  charm: number;
  strong: number;
  is_hungry: boolean;
  is_dirty: boolean;
  is_sad: boolean;
  is_sick: boolean;
  is_dead: boolean;
  updatedAt: string;
  updatedBy: AccountId;
}

export interface PetActResult {
  action: PetAction;
  updatedAt: string;
  updatedBy: AccountId;
  state: PetStateView;
}

export function isFixedAccountId(value: string): value is AccountId {
  return FIXED_ACCOUNT_IDS.includes(value as AccountId);
}
