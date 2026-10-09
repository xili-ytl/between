import { describe, expect, it } from "vitest";
import { wenliTimeContext } from "../src/domain/wenli-time-context.js";

describe("wenliTimeContext", () => {
  it("formats the authoritative Beijing value and keeps UTC as an explicit reference", () => {
    expect(wenliTimeContext(new Date("2026-09-14T14:59:00.000Z"))).toBe([
      "Authoritative current Beijing time (Asia/Shanghai, UTC+08:00): 2026-09-14T22:59:00+08:00",
      "UTC reference only: 2026-09-14T14:59:00.000Z",
      "For 现在/今天/昨天/明天 use the Beijing value above. Do not read the UTC hour as local time.",
      "The server clock already provides the current time; do not search the web to determine it."
    ].join("\n"));
  });

  it.each([
    ["2026-09-14T16:00:00.000Z", "2026-09-15T00:00:00+08:00"],
    ["2026-12-31T16:00:00.000Z", "2027-01-01T00:00:00+08:00"]
  ])("handles the Beijing date boundary for %s", (utc, beijing) => {
    expect(wenliTimeContext(new Date(utc))).toContain(`Authoritative current Beijing time (Asia/Shanghai, UTC+08:00): ${beijing}`);
  });
});
