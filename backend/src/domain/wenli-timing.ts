import { performance } from "node:perf_hooks";

export type WenliTimingStage =
  | "message_confirmation"
  | "kick_request"
  | "kick_total"
  | "job_materialize"
  | "job_lookup"
  | "claim"
  | "source_load"
  | "generation_total"
  | "context_prepare"
  | "tool_decision"
  | "public_search"
  | "final_generation"
  | "format_retry"
  | "reply_parse"
  | "persist"
  | "failure_persist"
  | "push"
  | "client_receive";

export type WenliTimingOutcome = "success" | "failure";

export interface WenliTimingUsage {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface WenliTimingEvent {
  /** A source/job/client id only; never a message body or a provider request body. */
  requestId: string;
  jobId?: string;
  stage: WenliTimingStage;
  durationMs: number;
  /** Provider calls made by this stage. Zero is used for local orchestration stages. */
  requestCount: number;
  outcome: WenliTimingOutcome;
  usage?: WenliTimingUsage;
}

export interface WenliTimingSink {
  record(event: WenliTimingEvent): void;
}

export interface WenliTimingContext {
  requestId: string;
  jobId?: string;
  sink: WenliTimingSink;
  monotonicClock: () => number;
}

export interface WenliTimingDetails {
  requestCount?: number;
  usage?: WenliTimingUsage;
}

export const NOOP_WENLI_TIMING_SINK: WenliTimingSink = { record: () => undefined };

/** The default is monotonic so wall-clock corrections cannot make a duration negative. */
export function defaultWenliMonotonicClock(): number {
  return performance.now();
}

export function startWenliTiming(
  context: WenliTimingContext | undefined,
  stage: WenliTimingStage
): (outcome: WenliTimingOutcome, details?: WenliTimingDetails) => void {
  if (!context) return () => undefined;
  const startedAt = context.monotonicClock();
  let finished = false;
  return (outcome, details = {}) => {
    if (finished) return;
    finished = true;
    const elapsed = context.monotonicClock() - startedAt;
    const durationMs = Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0;
    const event: WenliTimingEvent = {
      requestId: context.requestId,
      ...(context.jobId === undefined ? {} : { jobId: context.jobId }),
      stage,
      durationMs,
      requestCount: details.requestCount ?? 0,
      outcome,
      ...(details.usage === undefined ? {} : { usage: details.usage })
    };
    try {
      context.sink.record(event);
    } catch {
      // Diagnostics must never change the reply or persistence path.
    }
  };
}

export async function timeWenliStage<T>(
  context: WenliTimingContext | undefined,
  stage: WenliTimingStage,
  operation: () => Promise<T>,
  details?: (value: T) => WenliTimingDetails
): Promise<T> {
  const finish = startWenliTiming(context, stage);
  try {
    const value = await operation();
    finish("success", details?.(value));
    return value;
  } catch (error) {
    finish("failure");
    throw error;
  }
}

/**
 * Opt-in backend sink. The emitted record contains only bounded identifiers,
 * stage names, durations, request counts and provider usage; it never receives
 * prompt/response/query text. The default is undefined (no logging).
 */
export function createWenliTimingSink(
  env: Readonly<Record<string, string | undefined>>
): WenliTimingSink | undefined {
  if (env.WENLI_TIMING_ENABLED?.trim() !== "1") return undefined;
  return {
    record(event) {
      if (!SAFE_TIMING_ID.test(event.requestId) || (event.jobId !== undefined && !SAFE_TIMING_ID.test(event.jobId))) return;
      console.info(JSON.stringify({ type: "wenli_timing", ...event }));
    }
  };
}

const SAFE_TIMING_ID = /^[A-Za-z0-9_-]{1,200}$/u;
