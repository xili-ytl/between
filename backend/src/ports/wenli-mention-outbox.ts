import type { MessageRecord } from "../domain/contracts.js";

/**
 * The durable marker points at a message document that was read successfully
 * but can never be a valid human @小Q source. Callers may clear only this
 * explicitly classified error; transport and persistence failures remain
 * retryable.
 */
export class WenliPendingMentionInvalidError extends Error {
  constructor() {
    super("invalid pending Wenli mention");
    this.name = "WenliPendingMentionInvalidError";
  }
}

export function isWenliPendingMentionInvalidError(error: unknown): error is WenliPendingMentionInvalidError {
  return error instanceof WenliPendingMentionInvalidError;
}

export interface WenliMentionOutbox {
  getPendingMention(messageId: string): Promise<MessageRecord | null>;
  pendingMentionIds(afterId: string | null, limit: number): Promise<string[]>;
  acknowledgeMention(messageId: string): Promise<void>;
}
