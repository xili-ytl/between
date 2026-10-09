import type { AccountId, ImageMimeType } from "../domain/contracts.js";
import { IMAGE_EXTENSION, isImageMimeType } from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import type { ImageStorage } from "../ports/stores.js";

const CLIENT_MESSAGE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_CREDENTIALS_PER_MINUTE = 20;
const IMAGE_PREFIXES = ["chat-images", "moments-images"] as const;

export type ImagePrefix = (typeof IMAGE_PREFIXES)[number];

export interface UploadCredential {
  uploadUrl: string;
  authorization: string;
  token: string;
  cosFileId: string;
  key: string;
  fileId: string;
}
export class ImageService {
  private readonly credentialWindows = new Map<AccountId, number[]>();

  constructor(
    private readonly storage: ImageStorage,
    private readonly now: () => number = Date.now
  ) {}

  async uploadCredential(
    ownerId: AccountId,
    clientMessageId: string,
    mimeType: string,
    prefix: ImagePrefix = "chat-images"
  ): Promise<UploadCredential> {
    if (!CLIENT_MESSAGE_ID.test(clientMessageId)) {
      throw new AppError("MESSAGE_ID_INVALID", "消息编号无效");
    }
    if (!isImageMimeType(mimeType)) {
      throw new AppError("IMAGE_INVALID", "不支持的图片格式");
    }
    this.assertRateLimit(ownerId);
    const cloudPath = `${prefix}/${ownerId}_${clientMessageId}.${IMAGE_EXTENSION[mimeType]}`;
    const metadata = await this.storage.uploadMetadata(cloudPath);
    return {
      uploadUrl: metadata.uploadUrl,
      authorization: metadata.authorization,
      token: metadata.token,
      cosFileId: metadata.cosFileId,
      key: encodeURIComponent(cloudPath),
      fileId: metadata.fileId
    };
  }

  async imageUrl(imageFileId: string): Promise<string> {
    if (
      !imageFileId.startsWith("cloud://") ||
      !IMAGE_PREFIXES.some((prefix) => imageFileId.includes(`/${prefix}/`))
    ) {
      throw new AppError("IMAGE_INVALID", "图片文件编号无效");
    }
    return this.storage.temporaryFileUrl(imageFileId);
  }

  private assertRateLimit(ownerId: AccountId): void {
    const now = this.now();
    const cutoff = now - 60_000;
    const recent = (this.credentialWindows.get(ownerId) ?? []).filter((t) => t > cutoff);
    if (recent.length >= MAX_CREDENTIALS_PER_MINUTE) {
      throw new AppError("IMAGE_RATE_LIMITED", "图片上传过于频繁，请稍后再试");
    }
    recent.push(now);
    this.credentialWindows.set(ownerId, recent);
  }
}
