import { compareMessageCursors } from "./contracts.js";
import { AppError } from "./errors.js";

interface LegacyReadPosition {
  lastReadMessageId?: unknown;
  lastReadMessageCreatedAt?: unknown;
  lastSeenMomentAt?: unknown;
}

/** Recheck inside the store transaction: the service's earlier snapshot can be stale. */
export function assertLegacyReadStateForward(existing: LegacyReadPosition, patch: LegacyReadPosition): void {
  if (
    typeof patch.lastReadMessageCreatedAt === "string" &&
    typeof existing.lastReadMessageCreatedAt === "string" &&
    (patch.lastReadMessageCreatedAt < existing.lastReadMessageCreatedAt ||
      (typeof patch.lastReadMessageId === "string" &&
        typeof existing.lastReadMessageId === "string" &&
        compareMessageCursors(
          { id: patch.lastReadMessageId, createdAt: patch.lastReadMessageCreatedAt },
          { id: existing.lastReadMessageId, createdAt: existing.lastReadMessageCreatedAt }
        ) < 0))
  ) {
    throw new AppError("READ_STATE_BEHIND", "已读游标不能回退");
  }
  if (
    typeof patch.lastSeenMomentAt === "string" &&
    typeof existing.lastSeenMomentAt === "string" &&
    patch.lastSeenMomentAt < existing.lastSeenMomentAt
  ) {
    throw new AppError("READ_STATE_BEHIND", "已读游标不能回退");
  }
}
