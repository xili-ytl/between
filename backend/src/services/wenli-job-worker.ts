import { randomUUID } from "node:crypto";
import { assertValidWenliSource } from "../domain/wenli-reply.js";
import { buildWenliFactMemory } from "../domain/wenli-memory.js";
import { buildSourcedMemory, resolveWenliMemoryMutation } from "../domain/wenli-memory-candidate.js";
import type { MessageRecord } from "../domain/contracts.js";
import type { WenliJobExecutionStore } from "../ports/wenli-job-execution-store.js";
import type { WenliMemoryStore } from "../ports/wenli-memory-store.js";
import type { WenliReplyGenerator } from "../ports/wenli-reply-generator.js";
import { defaultWenliMonotonicClock, timeWenliStage, type WenliTimingContext, type WenliTimingSink } from "../domain/wenli-timing.js";

export interface WenliJobWorkerOptions {
  store: WenliJobExecutionStore;
  generator: WenliReplyGenerator;
  clock?: () => Date;
  tokenFactory?: () => string;
  leaseMs?: number;
  generationTimeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  memoryStore?: WenliMemoryStore;
  memoryIdFactory?: () => string;
  /** Optional, default-off diagnostics. */
  timingSink?: WenliTimingSink;
  monotonicClock?: () => number;
}

export interface WenliJobProcessResult {
  claimed: boolean;
  completed?: boolean;
  message?: MessageRecord | null;
}

const DEFAULTS = {
  leaseMs: 90_000,
  generationTimeoutMs: 45_000,
  maxAttempts: 3,
  retryBaseDelayMs: 30_000,
  retryMaxDelayMs: 300_000
};
const MAX_TIMER_MS = 2_147_483_647;
const MAX_ATTEMPTS = 100;

export class WenliJobWorker {
  private readonly store: WenliJobExecutionStore;
  private readonly generator: WenliReplyGenerator;
  private readonly clock: () => Date;
  private readonly tokenFactory: () => string;
  private readonly leaseMs: number;
  private readonly generationTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly memoryStore: WenliMemoryStore | undefined;
  private readonly memoryIdFactory: () => string;
  private readonly timingSink: WenliTimingSink | undefined;
  private readonly monotonicClock: () => number;

  constructor(options: WenliJobWorkerOptions) {
    this.store = options.store;
    this.generator = options.generator;
    this.clock = options.clock ?? (() => new Date());
    this.tokenFactory = options.tokenFactory ?? randomUUID;
    this.leaseMs = options.leaseMs ?? DEFAULTS.leaseMs;
    this.generationTimeoutMs = options.generationTimeoutMs ?? DEFAULTS.generationTimeoutMs;
    this.maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULTS.retryBaseDelayMs;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULTS.retryMaxDelayMs;
    this.memoryStore = options.memoryStore;
    this.memoryIdFactory = options.memoryIdFactory ?? (() => `mem_${randomUUID()}`);
    this.timingSink = options.timingSink;
    this.monotonicClock = options.monotonicClock ?? defaultWenliMonotonicClock;
    validateOptions(this.leaseMs, this.generationTimeoutMs, this.maxAttempts, this.retryBaseDelayMs, this.retryMaxDelayMs);
  }

  async process(jobId: string): Promise<WenliJobProcessResult> {
    const token = this.tokenFactory();
    const timing = this.timingContext(jobId);
    const claimed = await timeWenliStage(timing, "claim", () => this.store.claim(jobId, {
      now: this.now(),
      token,
      leaseMs: this.leaseMs,
      maxAttempts: this.maxAttempts
    }));
    if (!claimed) return { claimed: false, message: null };

    const source = await timeWenliStage(timing, "source_load", () => this.store.source(claimed.id));
    try {
      assertValidWenliSource(claimed.requesterId, source);
    } catch {
      await timeWenliStage(timing, "failure_persist", () => this.store.fail(claimed.id, token, this.now(), {
        code: "WENLI_SOURCE_INVALID",
        maxAttempts: this.maxAttempts,
        baseDelayMs: this.retryBaseDelayMs,
        maxDelayMs: this.retryMaxDelayMs,
        permanent: true
      }));
      return { claimed: true, completed: false, message: null };
    }

    try {
      const result = await timeWenliStage(timing, "generation_total", () => this.generateWithDeadline({
        jobId: claimed.id,
        requesterId: claimed.requesterId,
        source: structuredClone(source)
      }));
      const message = await timeWenliStage(timing, "persist", () => this.store.complete(claimed.id, token, this.now(), result.reply));
      if (message !== null && this.memoryStore && (result.memoryCandidate !== undefined || /忘记|别再记|不要再记|删除/u.test(source.body))) {
        await settleAuxiliaryMemory(async () => {
          const memory = /忘记|别再记|不要再记|删除/u.test(source.body)
            ? resolveWenliMemoryMutation(result.memoryCandidate, source, await (this.memoryStore!.listState?.(200) ?? this.memoryStore!.listForContext(200)))
            : buildSourcedMemory(result.memoryCandidate, source);
          if (memory) await this.memoryStore!.append(memory);
        });
      }
      if (message !== null && result.memoryUpdate !== null && this.memoryStore) {
        try {
          const summary = result.memoryUpdate;
          await settleAuxiliaryMemory(() => this.memoryStore!.append(buildWenliFactMemory({
            id: this.memoryIdFactory(), requesterId: claimed.requesterId, sourceMessageId: claimed.id,
            summary, now: this.now()
          })));
        } catch { /* The reply is already fenced and durable. */ }
      }
      return { claimed: true, completed: message !== null, message };
    } catch (error) {
      await timeWenliStage(timing, "failure_persist", () => this.store.fail(claimed.id, token, this.now(), {
        code: error instanceof WenliGenerationTimeout ? "WENLI_GENERATION_TIMEOUT" : "WENLI_GENERATION_FAILED",
        maxAttempts: this.maxAttempts,
        baseDelayMs: this.retryBaseDelayMs,
        maxDelayMs: this.retryMaxDelayMs
      }));
      return { claimed: true, completed: false, message: null };
    }
  }

  private timingContext(jobId: string): WenliTimingContext | undefined {
    return this.timingSink === undefined ? undefined : {
      requestId: jobId,
      jobId,
      sink: this.timingSink,
      monotonicClock: this.monotonicClock
    };
  }

  private generateWithDeadline(input: Parameters<WenliReplyGenerator["generate"]>[0]): Promise<import("../ports/wenli-reply-generator.js").WenliGenerationResult> {
    const controller = new AbortController();
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const generated = this.generator.generate(input, controller.signal);
    return new Promise<import("../ports/wenli-reply-generator.js").WenliGenerationResult>((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        if (!settled) {
          settled = true;
          reject(new WenliGenerationTimeout());
        }
      }, this.generationTimeoutMs);
      generated.then(
        (value) => {
          if (settled || timedOut) return;
          settled = true;
          resolve(value);
        },
        (error) => {
          if (settled || timedOut) return;
          settled = true;
          reject(error);
        }
      ).finally(() => {
        if (timer) clearTimeout(timer);
      });
    }).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  private now(): string {
    return this.clock().toISOString();
  }
}

/** Late completion is harmless: append is idempotent. Never hold a durable reply hostage. */
async function settleAuxiliaryMemory(write: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(write).catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 2000); })
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

class WenliGenerationTimeout extends Error {}

function validateOptions(
  leaseMs: number,
  generationTimeoutMs: number,
  maxAttempts: number,
  retryBaseDelayMs: number,
  retryMaxDelayMs: number
): void {
  for (const value of [leaseMs, generationTimeoutMs, maxAttempts, retryBaseDelayMs, retryMaxDelayMs]) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
      throw new Error("invalid Wenli worker options");
    }
  }
  if (leaseMs > MAX_TIMER_MS || generationTimeoutMs > MAX_TIMER_MS ||
    retryBaseDelayMs > MAX_TIMER_MS || retryMaxDelayMs > MAX_TIMER_MS ||
    maxAttempts > MAX_ATTEMPTS) {
    throw new Error("invalid Wenli worker options");
  }
  if (generationTimeoutMs >= leaseMs) throw new Error("invalid Wenli worker options");
}
