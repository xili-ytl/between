import { describe, expect, it } from "vitest";
import { WenliEvalBudget } from "../scripts/lib/wenli-eval-budget.js";

describe("isolated model evaluation budget", () => {
  it("refuses a request before sending it when the conservative reservation exceeds the remainder", () => {
    const budget = new WenliEvalBudget(0.15, 0.00000014, 0.00000028);
    budget.settle(0.1);
    expect(() => budget.reserve({ messages: [{ content: "查公开资料" }], max_tokens: 128, plugins: [{ id: "web" }] })).toThrow("before request");
    expect(budget.spentUsd).toBe(0.1);
  });
  it("stops rather than treating missing usage as free", () => {
    const budget = new WenliEvalBudget(0.15, 0.00000014, 0.00000028);
    expect(() => budget.settle(undefined)).toThrow("billing unavailable");
    expect(() => budget.reserve({ max_tokens: 2400 })).toThrow("stopped");
  });
  it("rejects unbounded completions and budgets above the user's limit", () => {
    expect(() => new WenliEvalBudget(0.51, 1e-7, 1e-7)).toThrow("invalid");
    expect(() => new WenliEvalBudget(0.15, 1e-7, 1e-7).reserve({ max_tokens: 0 })).toThrow("unbounded");
  });
});
