import type { WenliAgentJob } from "../domain/wenli-agent.js";

export interface WenliAgentJobStore {
  createIfAbsent(job: WenliAgentJob): Promise<WenliAgentJob>;
  get(jobId: string): Promise<WenliAgentJob | null>;
  listDue(now: string, limit: number): Promise<WenliAgentJob[]>;
}
