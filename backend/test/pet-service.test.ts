import { beforeEach, describe, expect, it } from "vitest";
import { MemoryPetStateStore, MemoryUserStore } from "../src/adapters/memory-stores.js";
import { INITIAL_PROFILES, type AccountId, type UserRecord } from "../src/domain/contracts.js";
import { hashPassword } from "../src/security/password.js";
import { PetService } from "../src/services/pet-service.js";

describe("PetService", () => {
  let petState: MemoryPetStateStore;
  let users: MemoryUserStore;
  let now: Date;
  let service: PetService;

  beforeEach(async () => {
    petState = new MemoryPetStateStore();
    users = new MemoryUserStore();
    now = new Date("2026-08-10T00:00:00.000Z");
    service = new PetService(petState, users, () => new Date(now));
    await users.save(await user("1001"));
    await users.save(await user("1002"));
  });

  it("initializes a default shared pet with both display names on first get", async () => {
    const state = await service.getState();
    expect(state).toMatchObject({
      name: "企鹅",
      host: "示例乙 & 示例甲",
      level: 1,
      hunger: 1000,
      clean: 1500,
      health: 5,
      mood: 500
    });
    expect(state.hunger_max).toBe(3100);
    expect(state.is_hungry).toBe(false);
    expect(state.is_dirty).toBe(false);
  });

  it("feeds up to the level cap and records the acting account", async () => {
    const fed = await service.act("1002", "feed", 1000);
    expect(fed.action).toBe("feed");
    expect(fed.updatedBy).toBe("1002");
    expect(fed.state.hunger).toBe(2000);

    const satiated = await service.act("1001", "feed", 100000);
    expect(satiated.state.hunger).toBe(3100);
    expect(satiated.state.updatedBy).toBe("1001");
  });

  it("bath/play/heal update the right stats and clamp to caps", async () => {
    const cleaned = await service.act("1001", "bath", 1000);
    expect(cleaned.state.clean).toBe(2500);

    const played = await service.act("1002", "play", 100);
    expect(played.state.mood).toBe(600);

    const healed = await service.act("1001", "heal");
    expect(healed.state.health).toBe(5);
    expect(healed.state.is_sick).toBe(false);
  });

  it("shares one pet state across both accounts", async () => {
    await service.act("1001", "feed", 1000);
    const after = await service.getState();
    expect(after.hunger).toBe(2000);
    expect(after.updatedBy).toBe("1001");
  });

  async function user(accountId: AccountId): Promise<UserRecord> {
    return {
      accountId,
      ...INITIAL_PROFILES[accountId],
      avatarKey: null,
      profileInitializedVersion: 0,
      passwordHash: await hashPassword("1013"),
      sessionHash: null,
      sessionVersion: 0,
      updatedAt: "2026-08-06T00:00:00.000Z"
    };
  }
});
