import type { AccountId } from "./contracts.js";

export type WenliAgentJobType = "mention" | "warmup";

export type WenliAgentJobStatus = "pending" | "running" | "retry" | "succeeded" | "dead";

export interface WenliAgentJob {
  id: string;
  type: WenliAgentJobType;
  requesterId: AccountId;
  sourceMessageId?: string;
  status: WenliAgentJobStatus;
  attemptCount: number;
  nextAttemptAt?: string;
  leaseUntil?: string;
  leaseToken?: string;
  responseMessageId?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
}
