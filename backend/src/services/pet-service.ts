import type {
  AccountId,
  PetAction,
  PetActResult,
  PetStateRecord,
  PetStateView
} from "../domain/contracts.js";
import type { PetStateStore, UserStore } from "../ports/stores.js";

/** 状态阈值（来自 Q 宠 game_data 逆向）。 */
const HUNGRY_THRESHOLD = 720;
const CLEAN_THRESHOLD = 1080;
const MOOD_THRESHOLD = 100;
const MOOD_MAX = 1000;
const HEALTH_NORMAL = 5;

/**
 * 情侣共同培养的 Q 宠。状态是云端唯一真相（`pet/couple`），两人各自电脑看到的都是同一只。
 * v1：不共享背包、状态不随时间衰减、等级成长不做（初始化 1 级）。
 */
export class PetService {
  constructor(
    private readonly petState: PetStateStore,
    private readonly users: UserStore,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async getState(): Promise<PetStateView> {
    const record = await this.petState.get("couple");
    return viewOf(record ?? await this.initialize());
  }

  async act(accountId: AccountId, action: PetAction, amount?: number): Promise<PetActResult> {
    const current = await this.petState.get("couple");
    const base = current ?? await this.initialize();
    const updated = applyAction(base, accountId, action, amount, this.clock().toISOString());
    await this.petState.save(updated);
    return {
      action,
      updatedAt: updated.updatedAt,
      updatedBy: updated.updatedBy,
      state: viewOf(updated)
    };
  }

  /** 首次访问时用双方昵称初始化默认企鹅（幂等：save 覆盖为确定性默认值）。 */
  private async initialize(): Promise<PetStateRecord> {
    const both = await Promise.all([this.users.get("1001"), this.users.get("1002")]);
    const host = both.filter(Boolean).map((user) => user!.displayName).join(" & ") || "之间";
    const now = this.clock().toISOString();
    const record: PetStateRecord = {
      id: "couple",
      name: "企鹅",
      host,
      sex: "公",
      growth: 0,
      hunger: 1000,
      clean: 1500,
      health: HEALTH_NORMAL,
      mood: 500,
      yb: 1000,
      intel: 0,
      charm: 0,
      strong: 0,
      birthDay: now,
      level: 1,
      updatedAt: now,
      updatedBy: "1001"
    };
    await this.petState.save(record);
    return record;
  }
}

function applyAction(
  base: PetStateRecord,
  accountId: AccountId,
  action: PetAction,
  amount: number | undefined,
  updatedAt: string
): PetStateRecord {
  const state: PetStateRecord = { ...base, updatedAt, updatedBy: accountId };
  const maxHungerClean = maxHungerCleanFor(state.level);
  switch (action) {
    case "feed":
      state.hunger = Math.min(state.hunger + (amount ?? 1000), maxHungerClean);
      break;
    case "bath":
      state.clean = Math.min(state.clean + (amount ?? 1000), maxHungerClean);
      break;
    case "play":
      state.mood = Math.min(state.mood + (amount ?? 100), MOOD_MAX);
      break;
    case "heal":
      state.health = HEALTH_NORMAL;
      break;
  }
  return state;
}

/** 饥饿/清洁上限：3000 + 100 * min(level, 30)（来自 Q 宠 game_data）。 */
function maxHungerCleanFor(level: number): number {
  return 3000 + 100 * Math.min(level, 30);
}

function viewOf(record: PetStateRecord): PetStateView {
  const maxHungerClean = maxHungerCleanFor(record.level);
  return {
    name: record.name,
    host: record.host,
    sex: record.sex,
    level: record.level,
    growth: record.growth,
    hunger: record.hunger,
    hunger_max: maxHungerClean,
    clean: record.clean,
    clean_max: maxHungerClean,
    health: record.health,
    mood: record.mood,
    mood_max: MOOD_MAX,
    yb: record.yb,
    intel: record.intel,
    charm: record.charm,
    strong: record.strong,
    is_hungry: record.hunger < HUNGRY_THRESHOLD,
    is_dirty: record.clean < CLEAN_THRESHOLD,
    is_sad: record.mood < MOOD_THRESHOLD,
    is_sick: record.health > 0 && record.health < HEALTH_NORMAL,
    is_dead: record.health === 0,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy
  };
}
