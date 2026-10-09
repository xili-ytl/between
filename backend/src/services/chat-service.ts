import type {
  AccountId,
  ImageMessageFields,
  ImageMimeType,
  MessageCursor,
  MessagePage,
  MessageRecord
} from "../domain/contracts.js";
import { IMAGE_EXTENSION, isImageMimeType } from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import { buildWenliReply } from "../domain/wenli-reply.js";
import { isHumanWenliMention } from "../domain/wenli-mention.js";
import type { MessageStore } from "../ports/stores.js";
import type { HumanMessageObserver } from "./wenli-trigger-service.js";

const CLIENT_MESSAGE_ID = /^[A-Za-z0-9_-]{1,100}$/;

export class ChatService {
  constructor(
    private readonly messages: MessageStore,
    private readonly clock: () => Date = () => new Date(),
    private readonly humanMessageObserver?: HumanMessageObserver
  ) {}

  async send(
    senderId: AccountId,
    clientMessageId: string,
    rawBody: string,
    replyToMessageId?: string,
    image?: ImageMessageFields
  ): Promise<MessageRecord> {
    if (!CLIENT_MESSAGE_ID.test(clientMessageId)) {
      throw new AppError("MESSAGE_ID_INVALID", "消息编号无效");
    }

    const body = rawBody.trim();
    if (image !== undefined) {
      validateImage(image, senderId, clientMessageId, body);
    } else {
      const length = [...body].length;
      if (length < 1 || length > 2000) {
        throw new AppError("MESSAGE_INVALID", "消息内容须为 1 至 2000 个字符");
      }
    }

    const recipientId: AccountId = senderId === "1001" ? "1002" : "1001";
    if (replyToMessageId !== undefined) {
      const repliedMessage = await this.messages.get(replyToMessageId);
      if (repliedMessage?.relationshipId !== "couple") {
        throw new AppError("REPLY_MESSAGE_INVALID", "被引用的消息不存在");
      }
    }
    const message: MessageRecord = {
      id: `${senderId}_${clientMessageId}`,
      relationshipId: "couple",
      senderId,
      recipientId,
      clientMessageId,
      body,
      ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
      ...(image === undefined ? {} : { type: "image" as const, ...image }),
      createdAt: this.clock().toISOString()
    };
    const persisted = await this.messages.appendIfAbsent(message, {
      captureWenliMention: this.humanMessageObserver !== undefined && isHumanWenliMention(message)
    });
    if (this.humanMessageObserver) {
      await this.humanMessageObserver.afterHumanMessage(persisted).catch(() => null);
    }
    return persisted;
  }

  async sendAsWenli(
    requesterId: AccountId,
    sourceMessageId: string,
    rawBody: string
  ): Promise<MessageRecord> {
    return this.messages.appendIfAbsent(buildWenliReply(
      requesterId,
      await this.messages.get(sourceMessageId),
      rawBody,
      this.clock().toISOString()
    ));
  }

  async after(cursor: MessageCursor | null, limit: number): Promise<MessagePage> {
    this.assertPageSize(limit);
    const items = await this.messages.after(cursor, limit);
    return { items, nextCursor: items.length === 0 ? null : cursorOf(items.at(-1)!) };
  }

  async before(cursor: MessageCursor | null, limit: number): Promise<MessagePage> {
    this.assertPageSize(limit);
    const descendingItems = await this.messages.before(cursor, limit);
    const items = descendingItems.reverse();
    return { items, nextCursor: items.length === 0 ? null : cursorOf(items[0]!) };
  }

  private assertPageSize(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new AppError("PAGE_SIZE_INVALID", "每页消息数量须为 1 至 50");
    }
  }
}
function cursorOf(message: MessageRecord): MessageCursor {
  return { createdAt: message.createdAt, id: message.id };
}

function validateImage(
  image: ImageMessageFields,
  senderId: AccountId,
  clientMessageId: string,
  body: string
): void {
  const { imageFileId, imageMimeType, imageWidth, imageHeight } = image;
  if ([...body].length > 2000) {
    throw new AppError("IMAGE_INVALID", "图片消息正文不能超过 2000 个字符");
  }
  if (!isImageMimeType(imageMimeType)) {
    throw new AppError("IMAGE_INVALID", "不支持的图片格式");
  }
  const expectedSuffix = `/chat-images/${senderId}_${clientMessageId}.${IMAGE_EXTENSION[imageMimeType]}`;
  if (!imageFileId.startsWith("cloud://") || !imageFileId.endsWith(expectedSuffix)) {
    throw new AppError("IMAGE_INVALID", "图片文件编号无效");
  }
  if ((imageWidth === undefined) !== (imageHeight === undefined)) {
    throw new AppError("IMAGE_INVALID", "图片尺寸无效");
  }
  for (const dimension of [imageWidth, imageHeight]) {
    if (dimension !== undefined && (!Number.isInteger(dimension) || dimension < 1 || dimension > 20000)) {
      throw new AppError("IMAGE_INVALID", "图片尺寸无效");
    }
  }
}
