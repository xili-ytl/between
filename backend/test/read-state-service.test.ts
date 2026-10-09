import { beforeEach, describe, expect, it } from "vitest";
import {
  MemoryMessageStore,
  MemoryReadStateStore,
  MemoryRelationshipStore
} from "../src/adapters/memory-stores.js";
import type { MessageRecord } from "../src/domain/contracts.js";
import { ReadStateService } from "../src/services/read-state-service.js";

describe("ReadStateService", () => {
  let now: Date;
  let service: ReadStateService;

  beforeEach(() => {
    now = new Date("2026-08-09T00:00:00.000Z");
    service = new ReadStateService(new MemoryReadStateStore(), () => new Date(now));
  });

  it("returns an empty read state when nothing stored yet", async () => {
    const state = await service.get("1001");
    expect(state.accountId).toBe("1001");
    expect(state.lastReadMessageCreatedAt).toBeUndefined();
    expect(state.lastSeenMomentAt).toBeUndefined();
  });

  it("sets and reads back a read state, moving cursors forward", async () => {
    const first = await service.set("1001", {
      lastReadMessageId: "1002_m1",
      lastReadMessageCreatedAt: "2026-08-09T00:00:01.000Z"
    });
    expect(first.lastReadMessageId).toBe("1002_m1");

    const second = await service.set("1001", {
      lastReadMessageId: "1002_m2",
      lastReadMessageCreatedAt: "2026-08-09T00:00:02.000Z",
      lastSeenMomentAt: "2026-08-09T00:00:03.000Z"
    });
    expect(second.lastReadMessageCreatedAt).toBe("2026-08-09T00:00:02.000Z");
    expect(second.lastSeenMomentAt).toBe("2026-08-09T00:00:03.000Z");

    await expect(service.get("1001")).resolves.toMatchObject({
      lastReadMessageCreatedAt: "2026-08-09T00:00:02.000Z",
      lastSeenMomentAt: "2026-08-09T00:00:03.000Z"
    });
  });

  it("rejects moving the message read cursor backward", async () => {
    await service.set("1001", {
      lastReadMessageId: "1002_m2",
      lastReadMessageCreatedAt: "2026-08-09T00:00:02.000Z"
    });
    await expect(
      service.set("1001", {
        lastReadMessageId: "1002_m1",
        lastReadMessageCreatedAt: "2026-08-09T00:00:01.000Z"
      })
    ).rejects.toMatchObject({ code: "READ_STATE_BEHIND" });
  });

  it("rejects moving the moments seen cursor backward", async () => {
    await service.set("1001", { lastSeenMomentAt: "2026-08-09T00:00:03.000Z" });
    await expect(service.set("1001", { lastSeenMomentAt: "2026-08-09T00:00:02.000Z" }))
      .rejects.toMatchObject({ code: "READ_STATE_BEHIND" });
  });

  it("requires message id and cursor time together", async () => {
    await expect(
      service.set("1001", { lastReadMessageId: "1002_m1" })
    ).rejects.toMatchObject({ code: "READ_STATE_INVALID" });
    await expect(
      service.set("1001", { lastReadMessageCreatedAt: "2026-08-09T00:00:01.000Z" })
    ).rejects.toMatchObject({ code: "READ_STATE_INVALID" });
  });

  it("rejects malformed timestamps", async () => {
    await expect(
      service.set("1001", { lastReadMessageId: "1002_m1", lastReadMessageCreatedAt: "not-a-timestamp" })
    ).rejects.toMatchObject({ code: "READ_STATE_INVALID" });
  });

  it("keeps the new receipt cursor separate from the legacy unread cursor", async () => {
    const states = new MemoryReadStateStore();
    const messages = new MemoryMessageStore();
    const relationships = await relationshipStore();
    const receiptService = new ReadStateService(states, () => new Date(now), messages, relationships);
    await receiptService.set("1001", {
      lastReadMessageId: "1002_legacy",
      lastReadMessageCreatedAt: "2026-08-09T00:00:01.000Z"
    });

    const state = await receiptService.get("1001");
    expect(state.lastReadMessageId).toBe("1002_legacy");
    expect(state).not.toHaveProperty("readReceiptMessageId");
    expect(state).not.toHaveProperty("partnerReadReceiptMessageId");
  });

  it("validates a real relationship message and only exposes the partner receipt", async () => {
    const states = new MemoryReadStateStore();
    const messages = new MemoryMessageStore();
    const relationships = await relationshipStore();
    await messages.appendIfAbsent(message("1001_m1", "2026-08-09T00:00:01.000Z", "1001"));
    await messages.appendIfAbsent(message("1002_m1", "2026-08-09T00:00:01.000Z", "1002"));
    const receiptService = new ReadStateService(states, () => new Date(now), messages, relationships);

    await receiptService.set("1001", {
      readReceiptMessageId: "1002_m1",
      readReceiptMessageCreatedAt: "2026-08-09T00:00:01.000Z"
    });
    const ownState = await receiptService.get("1001");
    expect(ownState).toMatchObject({
      readReceiptMessageId: "1002_m1",
      readReceiptMessageCreatedAt: "2026-08-09T00:00:01.000Z",
    });
    expect(ownState).not.toHaveProperty("partnerReadReceiptMessageId");

    await receiptService.set("1002", {
      readReceiptMessageId: "1001_m1",
      readReceiptMessageCreatedAt: "2026-08-09T00:00:01.000Z"
    });
    await expect(receiptService.get("1001")).resolves.toMatchObject({
      partnerReadReceiptMessageId: "1001_m1",
      partnerReadReceiptMessageCreatedAt: "2026-08-09T00:00:01.000Z"
    });
  });

  it("rejects a forged, missing, or timestamp-mismatched receipt message", async () => {
    const messages = new MemoryMessageStore();
    const relationships = await relationshipStore();
    await messages.appendIfAbsent(message("1002_real", "2026-08-09T00:00:01.000Z", "1002"));
    const receiptService = new ReadStateService(
      new MemoryReadStateStore(),
      () => new Date(now),
      messages,
      relationships
    );

    await expect(receiptService.set("1001", {
      readReceiptMessageId: "future",
      readReceiptMessageCreatedAt: "2026-08-09T00:00:02.000Z"
    })).rejects.toMatchObject({ code: "READ_RECEIPT_INVALID" });
    await expect(receiptService.set("1001", {
      readReceiptMessageId: "1002_real",
      readReceiptMessageCreatedAt: "2026-08-09T00:00:02.000Z"
    })).rejects.toMatchObject({ code: "READ_RECEIPT_INVALID" });
    await expect(receiptService.set("1001", {
      readReceiptMessageId: "1002_real"
    })).rejects.toMatchObject({ code: "READ_RECEIPT_INVALID" });
  });

  it("keeps same-time receipt writes in total order and never moves backward", async () => {
    const messages = new MemoryMessageStore();
    const relationships = await relationshipStore();
    await messages.appendIfAbsent(message("1002_a", "2026-08-09T00:00:01.000Z", "1002"));
    await messages.appendIfAbsent(message("1002_b", "2026-08-09T00:00:01.000Z", "1002"));
    const receiptService = new ReadStateService(
      new MemoryReadStateStore(),
      () => new Date(now),
      messages,
      relationships
    );

    await receiptService.set("1001", {
      readReceiptMessageId: "1002_b",
      readReceiptMessageCreatedAt: "2026-08-09T00:00:01.000Z"
    });
    await receiptService.set("1001", {
      readReceiptMessageId: "1002_a",
      readReceiptMessageCreatedAt: "2026-08-09T00:00:01.000Z"
    });
    await expect(receiptService.get("1001")).resolves.toMatchObject({
      readReceiptMessageId: "1002_b"
    });
  });

  it("rejects a same-time legacy cursor that moves backward by message ID", async () => {
    await service.set("1001", {
      lastReadMessageId: "1002_b",
      lastReadMessageCreatedAt: "2026-08-09T00:00:01.000Z"
    });
    await expect(service.set("1001", {
      lastReadMessageId: "1002_a",
      lastReadMessageCreatedAt: "2026-08-09T00:00:01.000Z"
    })).rejects.toMatchObject({ code: "READ_STATE_BEHIND" });
    expect((await service.get("1001")).lastReadMessageId).toBe("1002_b");
  });

  it("keeps timestamp-only legacy records from moving backward", async () => {
    const states = new MemoryReadStateStore();
    await states.save({ accountId: "1001", lastReadMessageCreatedAt: "2026-08-09T00:00:02.000Z", updatedAt: "old" });
    const legacyService = new ReadStateService(states, () => new Date(now));

    await expect(legacyService.set("1001", {
      lastReadMessageId: "1002_a", lastReadMessageCreatedAt: "2026-08-09T00:00:01.000Z"
    })).rejects.toMatchObject({ code: "READ_STATE_BEHIND" });
    expect((await legacyService.get("1001")).updatedAt).toBe("old");
  });

  it("rejects stale writes in the memory store after another request advanced the state", async () => {
    const states = new MemoryReadStateStore();
    await states.patchLegacyReadState("1001", {
      lastReadMessageId: "1002_new",
      lastReadMessageCreatedAt: "2026-08-09T00:00:02.000Z"
    }, "new");
    await expect(states.patchLegacyReadState("1001", {
      lastReadMessageId: "1002_old",
      lastReadMessageCreatedAt: "2026-08-09T00:00:01.000Z"
    }, "late")).rejects.toMatchObject({ code: "READ_STATE_BEHIND" });
    expect(await states.get("1001")).toMatchObject({ lastReadMessageId: "1002_new", updatedAt: "new" });
  });

  it("confirms a valid older receipt without rewinding a newer legacy unread position", async () => {
    const states = new MemoryReadStateStore();
    const messages = new MemoryMessageStore();
    const relationships = await relationshipStore();
    const oldTime = "2026-08-09T00:00:01.000Z";
    const newTime = "2026-08-09T00:00:02.000Z";
    await messages.appendIfAbsent(message("1002_old", oldTime, "1002"));
    await messages.appendIfAbsent(message("1002_new", newTime, "1002"));
    const receiptService = new ReadStateService(states, () => new Date(now), messages, relationships);
    await receiptService.set("1001", { lastReadMessageId: "1002_new", lastReadMessageCreatedAt: newTime });

    // Viewing older history is still valid. It must not enter an endless retry
    // just because a separate unread marker is already farther ahead.
    await expect(receiptService.set("1001", {
      readReceiptMessageId: "1002_old", readReceiptMessageCreatedAt: oldTime,
      lastReadMessageId: "1002_old", lastReadMessageCreatedAt: oldTime
    })).resolves.toMatchObject({
      readReceiptMessageId: "1002_old",
      lastReadMessageId: "1002_new"
    });
    expect((await receiptService.get("1002")).partnerReadReceiptMessageId).toBe("1002_old");
  });
});

async function relationshipStore(): Promise<MemoryRelationshipStore> {
  const relationships = new MemoryRelationshipStore();
  await relationships.createIfAbsent({
    id: "couple",
    memberIds: ["1001", "1002"],
    createdAt: "2026-08-01T00:00:00.000Z"
  });
  return relationships;
}

function message(id: string, createdAt: string, senderId: "1001" | "1002"): MessageRecord {
  return {
    id,
    relationshipId: "couple",
    senderId,
    recipientId: senderId === "1001" ? "1002" : "1001",
    clientMessageId: id.substring(id.indexOf("_") + 1),
    body: id,
    createdAt
  };
}
