import { describe, it, expect } from "vitest";
import { runnerPollDelay } from "../src/services/wenli-runner-poll-policy.js";

describe("runner idle polling", () => {
  it("backs off idle checks, caps them, and resumes quickly after work", () => {
    expect(runnerPollDelay(0, 3000)).toBe(3000);
    expect(runnerPollDelay(1, 3000)).toBe(6000);
    expect(runnerPollDelay(10, 3000)).toBe(60000);
    expect(runnerPollDelay(0, 3000)).toBe(3000);
  });
  it("rejects invalid intervals instead of spinning", () => {
    expect(() => runnerPollDelay(0, NaN)).toThrow();
    expect(() => runnerPollDelay(0, 0)).toThrow();
  });
});
