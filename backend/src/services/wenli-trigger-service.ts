import type { MessageRecord } from "../domain/contracts.js";
import type { WenliAgentJob } from "../domain/wenli-agent.js";
import { isHumanWenliMention } from "../domain/wenli-mention.js";
import type { WenliAgentJobStore } from "../ports/wenli-agent-job-store.js";
import {
  isWenliPendingMentionInvalidError,
  WenliPendingMentionInvalidError,
  type WenliMentionOutbox
} from "../ports/wenli-mention-outbox.js";
import { defaultWenliMonotonicClock, startWenliTiming, type WenliTimingContext, type WenliTimingSink } from "../domain/wenli-timing.js";

export { isWenliMention } from "../domain/wenli-mention.js";

export interface HumanMessageObserver {
  afterHumanMessage(message: MessageRecord): Promise<WenliAgentJob | null>;
}

export interface WenliMentionReconciliation {
  scanned: number;
  recovered: number;
  failed: number;
  nextCursor: string | null;
}

export class WenliTriggerService implements HumanMessageObserver {
  constructor(
    private readonly jobs: WenliAgentJobStore,
    private readonly outbox: WenliMentionOutbox,
    private readonly clock: () => Date = () => new Date(),
    private readonly timingSink?: WenliTimingSink,
    private readonly monotonicClock: () => number = defaultWenliMonotonicClock
  ) {}

  async afterHumanMessage(message: MessageRecord): Promise<WenliAgentJob | null> {
    return this.materialize(message.id);
  }

  async reconcilePending(afterId: string | null, limit: number): Promise<WenliMentionReconciliation> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
      (afterId !== null && (typeof afterId !== "string" || afterId.length === 0 || afterId.length > 200))) {
      throw new Error("invalid Wenli mention page");
    }
    const ids = await this.outbox.pendingMentionIds(afterId, limit);
    let recovered = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        if (await this.materialize(id)) recovered += 1;
      } catch (error) {
        if (isWenliPendingMentionInvalidError(error)) {
          // The scan ID is the only trusted acknowledgement target. A
          // malformed source is permanently unusable, but the message body
          // remains untouched; acknowledgement only clears the internal flag.
          try {
            await this.outbox.acknowledgeMention(id);
          } catch {
            // A failed acknowledgement is a persistence failure: retain the
            // marker so a later reconciliation can retry it.
          }
        }
        failed += 1;
      }
    }
    // A null cursor after an empty page starts the next sweep, including late lower IDs.
    return { scanned: ids.length, recovered, failed, nextCursor: ids.at(-1) ?? null };
  }

  private async materialize(messageId: string): Promise<WenliAgentJob | null> {
    const finish = startWenliTiming(this.timingContext(messageId), "job_materialize");
    try {
      const source = await this.outbox.getPendingMention(messageId);
      if (source === null) {
        finish("success");
        return null;
      }
      if (source.id !== messageId || !isHumanWenliMention(source)) {
        throw new WenliPendingMentionInvalidError();
      }
      const now = this.clock().toISOString();
      const job = await this.jobs.createIfAbsent({
        id: source.id,
        type: "mention",
        requesterId: source.senderId,
        sourceMessageId: source.id,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now
      });
      if (job.id !== source.id || job.type !== "mention" || job.requesterId !== source.senderId ||
        job.sourceMessageId !== source.id) {
        throw new Error("invalid Wenli mention job identity");
      }
      await this.outbox.acknowledgeMention(source.id);
      finish("success");
      return job;
    } catch (error) {
      finish("failure");
      throw error;
    }
  }

  private timingContext(messageId: string): WenliTimingContext | undefined {
    return this.timingSink === undefined || !SAFE_TIMING_ID.test(messageId) ? undefined : {
      requestId: messageId,
      jobId: messageId,
      sink: this.timingSink,
      monotonicClock: this.monotonicClock
    };
  }
}

const SAFE_TIMING_ID = /^[A-Za-z0-9_-]{1,200}$/u;
