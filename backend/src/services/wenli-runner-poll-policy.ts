/** Idle runners must not query the cloud at the active-job rate indefinitely. */
export function runnerPollDelay(idleRounds: number, baseMs: number): number {
  if (!Number.isSafeInteger(baseMs) || baseMs < 1000 || baseMs > 60000) {
    throw new Error("Runner interval must be 1000..60000 ms");
  }
  return Math.min(60000, baseMs * 2 ** Math.min(6, Math.max(0, idleRounds)));
}
