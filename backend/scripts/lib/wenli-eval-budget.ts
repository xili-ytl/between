/** Conservative reservation for the isolated evaluation; missing billing stops further requests. */
export class WenliEvalBudget {
  spentUsd = 0;
  reservedUsd = 0;
  stopped = false;
  constructor(readonly limitUsd: number, readonly promptPrice: number, readonly completionPrice: number) {
    if (![limitUsd, promptPrice, completionPrice].every(value => Number.isFinite(value) && value > 0) || limitUsd > 0.5) {
      throw new Error("invalid evaluation budget or pricing");
    }
  }
  reserve(body: Record<string, unknown>): number {
    if (this.stopped) throw new Error("evaluation stopped: billing unavailable");
    const maxTokens = body.max_tokens;
    if (!Number.isInteger(maxTokens) || (maxTokens as number) < 1 || (maxTokens as number) > 2400) throw new Error("unbounded completion");
    const input = JSON.stringify(body);
    const images = input.match(/"type":"image_url"/gu)?.length ?? 0;
    const upperBound = (Buffer.byteLength(input, "utf8") + images * 8192) * this.promptPrice +
      (maxTokens as number) * this.completionPrice + (Array.isArray(body.plugins) && body.plugins.length ? 0.1 : 0);
    if (this.spentUsd + this.reservedUsd + upperBound > this.limitUsd) throw new Error("evaluation budget exhausted before request");
    this.reservedUsd += upperBound;
    return upperBound;
  }
  settle(cost: unknown, reservation = 0): void {
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
      this.stopped = true;
      throw new Error("evaluation stopped: billing unavailable");
    }
    this.reservedUsd = Math.max(0, this.reservedUsd - reservation);
    this.spentUsd += cost;
    if (this.spentUsd > this.limitUsd) {
      this.stopped = true;
      throw new Error("evaluation budget exceeded; no further requests");
    }
  }
}
