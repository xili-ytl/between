import { describe, expect, it } from "vitest";
import { MemoryContactRemarkStore } from "../src/adapters/memory-stores.js";
import { RemarkService } from "../src/services/remark-service.js";

describe("RemarkService", () => {
  it("keeps each account's remark private", async () => {
    const service = new RemarkService(
      new MemoryContactRemarkStore(),
      () => new Date("2026-08-08T08:00:00.000Z")
    );

    await expect(service.get("1001", "1002")).resolves.toEqual({
      targetId: "1002",
      remark: "",
      updatedAt: null
    });
    await service.set("1001", "1002", "  宝宝  ");

    await expect(service.get("1001", "1002")).resolves.toMatchObject({ remark: "宝宝" });
    await expect(service.get("1002", "1001")).resolves.toMatchObject({ remark: "" });
  });

  it("allows clearing and rejects self or oversized remarks", async () => {
    const service = new RemarkService(new MemoryContactRemarkStore());
    await service.set("1001", "1002", "示例甲");
    await expect(service.set("1001", "1002", "   ")).resolves.toMatchObject({ remark: "" });
    await expect(service.set("1001", "1001", "自己"))
      .rejects.toMatchObject({ code: "REMARK_TARGET_INVALID" });
    await expect(service.set("1001", "1002", "喵".repeat(33)))
      .rejects.toMatchObject({ code: "REMARK_INVALID" });
  });
});
