import type { MessageRecord } from "../domain/contracts.js";
import type { WenliAgentJob } from "../domain/wenli-agent.js";
import type { WenliAgentJobStore } from "./wenli-agent-job-store.js";

export type WenliJobFailureCode =
  | "WENLI_GENERATION_FAILED"
  | "WENLI_GENERATION_TIMEOUT"
  | "WENLI_SOURCE_INVALID"
  | "WENLI_REPLY_INVALID";

export interface WenliJobClaimOptions {
  now: string;
  token: string;
  leaseMs: number;
  maxAttempts: number;
}

export interface WenliJobFailureOptions {
  code: WenliJobFailureCode;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  permanent?: boolean;
}

export interface WenliJobExecutionStore extends WenliAgentJobStore {
  claim(jobId: string, options: WenliJobClaimOptions): Promise<WenliAgentJob | null>;
  source(jobId: string): Promise<MessageRecord | null>;
  complete(jobId: string, token: string, now: string, body: unknown): Promise<MessageRecord | null>;
  fail(jobId: string, token: string, now: string, failure: WenliJobFailureOptions): Promise<boolean>;
}
