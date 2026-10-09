import { describe, expect, it } from "vitest";
import { isFixedAccountId } from "../src/domain/contracts.js";

describe("fixed account contract", () => {
  it("accepts only the provisioned ids", () => {
    expect(isFixedAccountId("1001")).toBe(true);
    expect(isFixedAccountId("1002")).toBe(true);
    expect(isFixedAccountId("0000")).toBe(false);
  });
});
