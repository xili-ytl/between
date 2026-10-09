import type { MessageRecord } from "../domain/contracts.js";

export interface WenliReplyGenerator {
  generate(input: {
    jobId: string;
    requesterId: "1001" | "1002";
    source: MessageRecord;
  }, signal: AbortSignal): Promise<WenliGenerationResult>;
}

export interface WenliGenerationResult {
  reply: string;
  memoryUpdate: string | null;
  memoryCandidate?: unknown;
}
