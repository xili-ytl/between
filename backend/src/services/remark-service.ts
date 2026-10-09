import type { AccountId, ContactRemarkRecord } from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import type { ContactRemarkStore } from "../ports/stores.js";

export interface ContactRemarkView {
  targetId: AccountId;
  remark: string;
  updatedAt: string | null;
}

export class RemarkService {
  constructor(
    private readonly remarks: ContactRemarkStore,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async get(ownerId: AccountId, targetId: AccountId): Promise<ContactRemarkView> {
    this.assertTarget(ownerId, targetId);
    const record = await this.remarks.get(ownerId, targetId);
    return record === null
      ? { targetId, remark: "", updatedAt: null }
      : { targetId, remark: record.remark, updatedAt: record.updatedAt };
  }

  async set(ownerId: AccountId, targetId: AccountId, rawRemark: string): Promise<ContactRemarkView> {
    this.assertTarget(ownerId, targetId);
    const remark = rawRemark.trim();
    if ([...remark].length > 32) {
      throw new AppError("REMARK_INVALID", "备注最多 32 个字符");
    }
    const record: ContactRemarkRecord = {
      ownerId,
      targetId,
      remark,
      updatedAt: this.clock().toISOString()
    };
    await this.remarks.upsert(record);
    return { targetId, remark, updatedAt: record.updatedAt };
  }

  private assertTarget(ownerId: AccountId, targetId: AccountId): void {
    if (ownerId === targetId) {
      throw new AppError("REMARK_TARGET_INVALID", "只能备注另一方");
    }
  }
}
