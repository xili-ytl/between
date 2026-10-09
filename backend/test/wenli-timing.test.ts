import { describe, expect, it } from "vitest";
import { createWenliTimingSink, startWenliTiming, timeWenliStage } from "../src/domain/wenli-timing.js";

describe("Wenli timing diagnostics", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(createWenliTimingSink({})).toBeUndefined();
    expect(createWenliTimingSink({ WENLI_TIMING_ENABLED: "0" })).toBeUndefined();
  });

  it("records a bounded failure without changing the operation error", async () => {
    const events: unknown[] = [];
    let tick = 100;
    const finish = startWenliTiming({
      requestId: "1001_diag",
      sink: { record: (event) => events.push(event) },
      monotonicClock: () => (tick -= 3)
    }, "reply_parse");
    finish("failure", { requestCount: 1 });
    finish("success");

    await expect(timeWenliStage(
      {
        requestId: "1001_diag-2",
        sink: { record: (event) => events.push(event) },
        monotonicClock: () => 50
      },
      "final_generation",
      async () => { throw new Error("synthetic failure"); },
      () => ({ requestCount: 1 })
    )).rejects.toThrow("synthetic failure");

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: "1001_diag", stage: "reply_parse", durationMs: 0, outcome: "failure" }),
      expect.objectContaining({ requestId: "1001_diag-2", stage: "final_generation", durationMs: 0, outcome: "failure" })
    ]));
    expect(events).toHaveLength(2);
  });
});
