import type { AccountId, MessageRecord } from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import type { WenliAgentJobStore } from "../ports/wenli-agent-job-store.js";
import type { PushService } from "./push-service.js";
import type { WenliJobWorker } from "./wenli-job-worker.js";
import { startWenliTiming, timeWenliStage, type WenliTimingContext, type WenliTimingSink } from "../domain/wenli-timing.js";

export interface WenliKickResult {
  processed: boolean;
  messageId?: string;
}

export interface WenliSweepResult {
  processed: number;
}

export interface WenliPendingMentionReconciler {
  reconcilePending(afterId: string | null, limit: number): Promise<unknown>;
}

export interface WenliSweepOptions {
  /** Total wall-clock budget reserved for one sweep invocation. */
  sweepBudgetMs?: number;
  /** Maximum time a newly claimed job may need before the next claim. */
  perJobBudgetMs?: number;
  monotonicClock?: () => number;
  /** Optional, default-off diagnostics. */
  timingSink?: WenliTimingSink;
}

/**
 * 问理任务的两个入口：
 * - `kick`：手机端发出 `@问理` 后的加速请求（只是加速，后台 sweep 仍能兜底）。
 * - `sweep`：拉一批到期任务处理，用于手机前台定时兜底与人工补偿。
 * 两条路径都只负责驱动 worker 并推送；回复本身由 worker 在事务内落库。
 */
export class WenliService {
  constructor(
    private readonly jobs: WenliAgentJobStore,
    private readonly worker: WenliJobWorker,
    private readonly push?: Pick<PushService, "pushWenli">,
    private readonly clock: () => Date = () => new Date(),
    private readonly pendingMentions?: WenliPendingMentionReconciler,
    options: WenliSweepOptions = {}
  ) {
    this.sweepBudgetMs = options.sweepBudgetMs ?? DEFAULT_SWEEP_BUDGET_MS;
    this.perJobBudgetMs = options.perJobBudgetMs ?? DEFAULT_PER_JOB_BUDGET_MS;
    this.monotonicClock = options.monotonicClock ?? (() => Date.now());
    this.timingSink = options.timingSink;
    if (!positiveInteger(this.sweepBudgetMs) || !positiveInteger(this.perJobBudgetMs) ||
      this.perJobBudgetMs > this.sweepBudgetMs) {
      throw new Error("invalid Wenli sweep options");
    }
  }

  private readonly sweepBudgetMs: number;
  private readonly perJobBudgetMs: number;
  private readonly monotonicClock: () => number;
  private readonly timingSink: WenliTimingSink | undefined;

  async kick(accountId: AccountId, sourceMessageId: string): Promise<WenliKickResult> {
    const timing = this.timingContext(sourceMessageId);
    const finishTotal = startWenliTiming(timing, "kick_total");
    if (typeof sourceMessageId !== "string" || sourceMessageId.length === 0 || sourceMessageId.length > 200) {
      finishTotal("failure");
      throw new AppError("WENLI_SOURCE_INVALID", "问理触发消息无效");
    }
    try {
      const job = await timeWenliStage(timing, "job_lookup", () => this.jobs.get(sourceMessageId));
      if (!job || job.type !== "mention" || job.requesterId !== accountId) {
        throw new AppError("WENLI_SOURCE_INVALID", "问理触发消息无效");
      }
      // 已经回复过的任务不再生成，但仍告知调用方可以显示结果。
      if (job.status === "succeeded") {
        const answer = job.responseMessageId === undefined
          ? { processed: true }
          : { processed: true, messageId: job.responseMessageId };
        finishTotal("success");
        return answer;
      }
      const result = await this.worker.process(job.id);
      await timeWenliStage(timing, "push", () => this.pushReply(result.message));
      const answer = result.message === null || result.message === undefined
        ? { processed: result.claimed }
        : { processed: true, messageId: result.message.id };
      finishTotal("success");
      return answer;
    } catch (error) {
      finishTotal("failure");
      throw error;
    }
  }

  async sweep(limit: number): Promise<WenliSweepResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
      throw new AppError("PAGE_SIZE_INVALID", "单次处理数量须为 1 至 5");
    }
    const startedAt = this.monotonicClock();
    // A message can be durable while job materialization is still pending. Reconcile
    // the outbox first so a sweep can recover that accepted mention in the same pass.
    // Scan a bounded page independently of the worker page size so one malformed
    // pending item does not permanently hide later valid mentions.
    await this.pendingMentions?.reconcilePending(null, 100).catch(() => undefined);
    const due = await this.jobs.listDue(this.clock().toISOString(), limit);
    let processed = 0;
    for (const job of due) {
      if (this.monotonicClock() - startedAt + this.perJobBudgetMs > this.sweepBudgetMs) break;
      const result = await this.worker.process(job.id);
      await this.pushReply(result.message);
      if (result.claimed) processed += 1;
    }
    return { processed };
  }

  /** 问理回复推给双方；推送失败不影响已经落库的回复。 */
  private async pushReply(message: MessageRecord | null | undefined): Promise<void> {
    if (!this.push || !message) return;
    const alert = message.type === "image" ? "[图片]" : message.body;
    await this.push.pushWenli(alert, message.id, message.createdAt).catch(() => undefined);
  }

  private timingContext(sourceMessageId: string): WenliTimingContext | undefined {
    return this.timingSink === undefined || !SAFE_TIMING_ID.test(sourceMessageId) ? undefined : {
      requestId: sourceMessageId,
      jobId: sourceMessageId,
      sink: this.timingSink,
      monotonicClock: this.monotonicClock
    };
  }
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

const DEFAULT_SWEEP_BUDGET_MS = 50_000;
const DEFAULT_PER_JOB_BUDGET_MS = 45_000;
const SAFE_TIMING_ID = /^[A-Za-z0-9_-]{1,200}$/u;
