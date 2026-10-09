import {
  type AccountId,
  type MessageCursor,
  type ReadStateRecord,
  type ReadStateView
} from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import { assertLegacyReadStateForward } from "../domain/read-state.js";
import type { MessageStore, ReadStateStore, RelationshipStore } from "../ports/stores.js";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface ReadStateInput {
  lastReadMessageId?: string;
  lastReadMessageCreatedAt?: string;
  readReceiptMessageId?: string;
  readReceiptMessageCreatedAt?: string;
  lastSeenMomentAt?: string;
}

export class ReadStateService {
  constructor(
    private readonly states: ReadStateStore,
    private readonly clock: () => Date = () => new Date(),
    private readonly messages?: MessageStore,
    private readonly relationships?: RelationshipStore
  ) {}

  async get(accountId: AccountId): Promise<ReadStateView> {
    const existing = await this.states.get(accountId);
    const own = existing ?? { accountId, updatedAt: this.clock().toISOString() };
    return this.withPartnerCursor(accountId, own);
  }

  async set(accountId: AccountId, input: ReadStateInput): Promise<ReadStateView> {
    this.validateInput(input);
    const receiptId = input.readReceiptMessageId;
    const receiptCreatedAt = input.readReceiptMessageCreatedAt;
    const hasLegacyFields =
      input.lastReadMessageId !== undefined ||
      input.lastReadMessageCreatedAt !== undefined ||
      input.lastSeenMomentAt !== undefined;
    const needsExistingState =
      (receiptId === undefined && receiptCreatedAt === undefined) || hasLegacyFields;
    const existing = needsExistingState ? await this.states.get(accountId) : null;
    let record: ReadStateRecord;
    if (receiptId !== undefined && receiptCreatedAt !== undefined) {
      const cursor = await this.validateReadReceipt(accountId, {
        id: receiptId,
        createdAt: receiptCreatedAt
      });
      record = await this.states.advanceMessageReadReceipt(
        accountId,
        cursor,
        this.clock().toISOString()
      );
      if (
        input.lastReadMessageId === undefined &&
        input.lastReadMessageCreatedAt === undefined &&
        input.lastSeenMomentAt === undefined
      ) {
        return this.withPartnerCursor(accountId, record);
      }
      // A legacy client may send its old unread fields in the same request.
      // Merge them after the receipt advance so neither field family erases the other.
      try {
        assertLegacyReadStateForward(record, input);
        record = await this.states.patchLegacyReadState(
          accountId,
          {
            ...(input.lastReadMessageId === undefined ? {} : { lastReadMessageId: input.lastReadMessageId }),
            ...(input.lastReadMessageCreatedAt === undefined
              ? {}
              : { lastReadMessageCreatedAt: input.lastReadMessageCreatedAt }),
            ...(input.lastSeenMomentAt === undefined ? {} : { lastSeenMomentAt: input.lastSeenMomentAt })
          },
          this.clock().toISOString()
        );
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "READ_STATE_BEHIND") throw error;
        // The validated receipt is already committed. An older legacy marker
        // must not turn that success into perpetual client retries.
        record = await this.states.get(accountId) ?? record;
      }
      return this.withPartnerCursor(accountId, record);
    }

    if (existing) assertLegacyReadStateForward(existing, input);
    record = await this.states.patchLegacyReadState(
      accountId,
      {
        ...(input.lastReadMessageId === undefined ? {} : { lastReadMessageId: input.lastReadMessageId }),
        ...(input.lastReadMessageCreatedAt === undefined
          ? {}
          : { lastReadMessageCreatedAt: input.lastReadMessageCreatedAt }),
        ...(input.lastSeenMomentAt === undefined ? {} : { lastSeenMomentAt: input.lastSeenMomentAt })
      },
      this.clock().toISOString()
    );
    return this.withPartnerCursor(accountId, record);
  }

  private validateInput(input: ReadStateInput): void {
    const hasMessageId = input.lastReadMessageId !== undefined;
    const hasMessageCursor = input.lastReadMessageCreatedAt !== undefined;
    if (hasMessageId !== hasMessageCursor) {
      throw new AppError("READ_STATE_INVALID", "消息已读游标须同时提供 id 与时间");
    }
    if (hasMessageCursor && !ISO_TIMESTAMP.test(input.lastReadMessageCreatedAt!)) {
      throw new AppError("READ_STATE_INVALID", "已读游标时间格式无效");
    }
    const hasReceiptId = input.readReceiptMessageId !== undefined;
    const hasReceiptCursor = input.readReceiptMessageCreatedAt !== undefined;
    if (hasReceiptId !== hasReceiptCursor) {
      throw new AppError("READ_RECEIPT_INVALID", "阅读回执游标须同时提供 id 与时间");
    }
    if (hasReceiptCursor && !ISO_TIMESTAMP.test(input.readReceiptMessageCreatedAt!)) {
      throw new AppError("READ_RECEIPT_INVALID", "阅读回执时间格式无效");
    }
    if (input.lastSeenMomentAt !== undefined && !ISO_TIMESTAMP.test(input.lastSeenMomentAt)) {
      throw new AppError("READ_STATE_INVALID", "朋友圈已读时间格式无效");
    }
  }

  private async validateReadReceipt(accountId: AccountId, cursor: MessageCursor): Promise<MessageCursor> {
    if (!this.messages || !this.relationships) {
      throw new AppError("READ_RECEIPT_UNAVAILABLE", "阅读回执暂不可用");
    }
    const relationship = await this.relationships.get("couple");
    if (!relationship || !relationship.memberIds.includes(accountId)) {
      throw new AppError("READ_RECEIPT_INVALID", "当前账号不属于此聊天关系");
    }
    const message = await this.messages.get(cursor.id);
    if (
      !message ||
      message.relationshipId !== relationship.id ||
      message.createdAt !== cursor.createdAt
    ) {
      throw new AppError("READ_RECEIPT_INVALID", "阅读回执消息不存在或不匹配");
    }
    return cursor;
  }

  private async withPartnerCursor(accountId: AccountId, own: ReadStateRecord): Promise<ReadStateView> {
    if (!this.relationships) return own;
    const relationship = await this.relationships.get("couple");
    if (!relationship || !relationship.memberIds.includes(accountId)) return own;
    const partnerId = relationship.memberIds.find((memberId) => memberId !== accountId);
    if (!partnerId) return own;
    const partner = await this.states.get(partnerId);
    return {
      ...own,
      ...(partner?.readReceiptMessageId === undefined || partner.readReceiptMessageCreatedAt === undefined
        ? {}
        : {
            partnerReadReceiptMessageId: partner.readReceiptMessageId,
            partnerReadReceiptMessageCreatedAt: partner.readReceiptMessageCreatedAt
          })
    };
  }
}
