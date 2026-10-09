import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { INITIAL_PROFILES } from "../src/domain/contracts.js";

describe("initial profile identities and assets", () => {
  it("locks the requested display names and genders to the fixed accounts", () => {
    expect(INITIAL_PROFILES).toEqual({
      "1001": { displayName: "示例乙", gender: "女" },
      "1002": { displayName: "示例甲", gender: "男" }
    });
  });

  it.each([
    ["1001", "cb3811c1599a9871648272ceaaa21982c7e92deabc367facea3a6941e9804a9b"],
    ["1002", "b879f70cac2dca989da9691b445cdd5e0370bf1274e7ec00e66a827614d65928"]
  ] as const)("keeps the supplied %s JPEG byte-for-byte", async (accountId, expectedSha256) => {
    const bytes = await readFile(new URL(`../assets/initial-avatars/${accountId}.jpg`, import.meta.url));

    expect(createHash("sha256").update(bytes).digest("hex")).toBe(expectedSha256);
  });
});
