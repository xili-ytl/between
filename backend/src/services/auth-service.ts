import type { AccountId, PetSessionRecord, PetSessionResult, SessionResult, UserRecord } from "../domain/contracts.js";
import { isFixedAccountId } from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import type { LoginAttemptStore, PetSessionStore, SessionRotationFields, UserStore } from "../ports/stores.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import { createSessionToken, hashSessionToken } from "../security/session.js";

const MAX_FAILURES = 5;
const BLOCK_MILLISECONDS = 15 * 60 * 1000;
const PET_SESSION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;

export class AuthService {
  constructor(
    private readonly users: UserStore,
    private readonly attempts: LoginAttemptStore,
    private readonly petSessions: PetSessionStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  async login(accountValue: string, password: string, source: string): Promise<SessionResult> {
    if (!isFixedAccountId(accountValue)) {
      throw new AppError("CREDENTIALS_INVALID", "账号或密码错误");
    }

    const accountId = accountValue;
    await this.assertNotBlocked(accountId, source);
    const user = await this.users.get(accountId);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      await this.recordFailure(accountId, source);
      throw new AppError("CREDENTIALS_INVALID", "账号或密码错误");
    }

    await this.attempts.clear(accountId, source);
    return this.rotateSession(user.accountId);
  }

  async authenticate(sessionToken: string): Promise<UserRecord> {
    if (!sessionToken) throw new AppError("SESSION_INVALID", "登录已失效");
    const user = await this.users.findBySessionHash(hashSessionToken(sessionToken));
    if (!user) throw new AppError("SESSION_INVALID", "登录已失效");
    return user;
  }

  async logout(sessionToken: string): Promise<void> {
    const user = await this.authenticate(sessionToken);
    await this.users.invalidateSession(user.accountId, this.now().toISOString());
  }

  /**
   * 电脑端 Q 宠登录：颁发独立的只读会话，写入 petSessions，
   * 绝不轮换主会话 sessionHash —— 手机端的「之间」永不被顶下线。
   */
  async petLogin(accountValue: string, password: string, source: string): Promise<PetSessionResult> {
    if (!isFixedAccountId(accountValue)) {
      throw new AppError("CREDENTIALS_INVALID", "账号或密码错误");
    }
    const accountId = accountValue;
    await this.assertNotBlocked(accountId, source);
    const user = await this.users.get(accountId);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      await this.recordFailure(accountId, source);
      throw new AppError("CREDENTIALS_INVALID", "账号或密码错误");
    }
    await this.attempts.clear(accountId, source);

    const sessionToken = createSessionToken();
    const issuedAt = this.now();
    await this.petSessions.save({
      id: accountId,
      accountId,
      sessionHash: hashSessionToken(sessionToken),
      expiresAt: new Date(issuedAt.getTime() + PET_SESSION_MILLISECONDS).toISOString(),
      updatedAt: issuedAt.toISOString()
    });
    return {
      accountId: user.accountId,
      displayName: user.displayName,
      avatarKey: user.avatarKey,
      sessionToken
    };
  }

  /** 宠物只读会话认证：pet 会话可读聊天/朋友圈，任何写操作都在路由层被拒绝。 */
  async authenticatePet(sessionToken: string): Promise<{ user: UserRecord; role: "pet" }> {
    const pet = await this.requirePetSession(sessionToken);
    const user = await this.users.get(pet.accountId);
    if (!user) throw new AppError("SESSION_INVALID", "登录已失效");
    return { user, role: "pet" };
  }

  async petLogout(sessionToken: string): Promise<void> {
    const pet = await this.requirePetSession(sessionToken);
    await this.petSessions.remove(pet.accountId);
  }

  /** 主会话优先、pet 会话兜底的统一认证（main 失效时才尝试 pet）。 */
  async authenticateAny(sessionToken: string): Promise<{ user: UserRecord; role: "main" | "pet" }> {
    try {
      return { user: await this.authenticate(sessionToken), role: "main" };
    } catch (error) {
      if (error instanceof AppError && error.code === "SESSION_INVALID") {
        return this.authenticatePet(sessionToken);
      }
      throw error;
    }
  }

  async changePassword(
    sessionToken: string,
    currentPassword: string,
    replacementPassword: string
  ): Promise<SessionResult> {
    const user = await this.authenticate(sessionToken);
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new AppError("PASSWORD_INVALID", "当前密码错误");
    }
    const length = [...replacementPassword].length;
    if (length < 4 || length > 128) {
      throw new AppError("PASSWORD_INVALID", "新密码长度应为 4 到 128 个字符");
    }

    return this.rotateSession(user.accountId, await hashPassword(replacementPassword));
  }

  private async rotateSession(accountId: AccountId, passwordHash?: string): Promise<SessionResult> {
    const sessionToken = createSessionToken();
    const fields: SessionRotationFields = {
      sessionHash: hashSessionToken(sessionToken),
      updatedAt: this.now().toISOString()
    };
    if (passwordHash !== undefined) fields.passwordHash = passwordHash;
    const updated = await this.users.rotateSession(accountId, fields);
    if (!updated) throw new AppError("USER_NOT_FOUND", "账号不存在");
    return {
      accountId: updated.accountId,
      displayName: updated.displayName,
      avatarKey: updated.avatarKey,
      sessionToken,
      sessionVersion: updated.sessionVersion
    };
  }

  private async requirePetSession(sessionToken: string): Promise<PetSessionRecord> {
    if (!sessionToken) throw new AppError("SESSION_INVALID", "登录已失效");
    const pet = await this.petSessions.findBySessionHash(hashSessionToken(sessionToken));
    if (!pet) throw new AppError("SESSION_INVALID", "登录已失效");
    const expiresAt = Date.parse(pet.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now().getTime()) {
      await this.petSessions.remove(pet.accountId);
      throw new AppError("SESSION_INVALID", "登录已失效");
    }
    return pet;
  }

  private async assertNotBlocked(accountId: AccountId, source: string): Promise<void> {
    const record = await this.attempts.get(accountId, source);
    if (!record?.blockedUntil) return;
    if (new Date(record.blockedUntil).getTime() > this.now().getTime()) {
      throw new AppError("RATE_LIMITED", "登录尝试过多，请稍后再试");
    }
    await this.attempts.clear(accountId, source);
  }

  private async recordFailure(accountId: AccountId, source: string): Promise<void> {
    const current = await this.attempts.get(accountId, source);
    const failures = (current?.failures ?? 0) + 1;
    const blockedUntil = failures >= MAX_FAILURES
      ? new Date(this.now().getTime() + BLOCK_MILLISECONDS).toISOString()
      : null;
    await this.attempts.save(accountId, source, { failures, blockedUntil });
  }
}
