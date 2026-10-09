import { createHash } from "node:crypto";
import type { AccountId, AvatarObject, UserRecord } from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import type { AvatarStore, UserStore } from "../ports/stores.js";

const MAX_AVATAR_BYTES = 512 * 1024;
const AVATAR_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
} as const;

type AvatarContentType = keyof typeof AVATAR_EXTENSIONS;

export class ProfileService {
  constructor(
    private readonly users: UserStore,
    private readonly avatars: AvatarStore,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async getPair(): Promise<UserRecord[]> {
    const pair = await Promise.all([this.requireUser("1001"), this.requireUser("1002")]);
    return pair;
  }

  async updateDisplayName(accountId: AccountId, rawDisplayName: string): Promise<UserRecord> {
    const displayName = rawDisplayName.trim();
    const length = [...displayName].length;
    if (length < 1 || length > 30) {
      throw new AppError("DISPLAY_NAME_INVALID", "用户名须为 1 至 30 个字符");
    }

    const updated = await this.users.updateDisplayName(accountId, displayName, this.clock().toISOString());
    if (!updated) throw new AppError("USER_NOT_FOUND", "账号不存在");
    return updated;
  }

  async updateAvatar(accountId: AccountId, contentType: string, bytes: Uint8Array): Promise<UserRecord> {
    if (!isAvatarContentType(contentType) || bytes.byteLength < 1 || bytes.byteLength > MAX_AVATAR_BYTES) {
      throw new AppError("AVATAR_INVALID", "头像须为不超过 512 KiB 的 JPEG、PNG 或 WebP 图片");
    }

    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const key = `avatars/${accountId}/${digest}.${AVATAR_EXTENSIONS[contentType]}`;
    const avatar: AvatarObject = { contentType, bytes };
    const storedKey = await this.avatars.put(key, avatar);

    const updated = await this.users.updateAvatar(accountId, storedKey, this.clock().toISOString());
    if (!updated) throw new AppError("USER_NOT_FOUND", "账号不存在");
    return updated;
  }

  async avatarUrl(avatarKey: string | null): Promise<string | null> {
    return avatarKey === null ? null : this.avatars.temporaryUrl(avatarKey);
  }

  private async requireUser(accountId: AccountId): Promise<UserRecord> {
    const user = await this.users.get(accountId);
    if (!user) {
      throw new AppError("USER_NOT_FOUND", "账号不存在");
    }
    return user;
  }
}

function isAvatarContentType(contentType: string): contentType is AvatarContentType {
  return Object.hasOwn(AVATAR_EXTENSIONS, contentType);
}
