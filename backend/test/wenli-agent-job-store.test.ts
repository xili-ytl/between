import { describe, expect, it, vi } from "vitest";
import { CloudBaseWenliAgentJobStore, MemoryWenliAgentJobStore } from "../src/adapters/wenli-agent-job-stores.js";
import type { WenliAgentJob } from "../src/domain/wenli-agent.js";
import type { WenliAgentJobStore } from "../src/ports/wenli-agent-job-store.js";

const pendingJob: WenliAgentJob = {
  id: "1001_source-1",
  type: "mention",
  requesterId: "1001",
  sourceMessageId: "1001_source-1",
  status: "pending",
  attemptCount: 0,
  nextAttemptAt: "2026-08-30T00:00:00.000Z",
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z"
};

function jobStoreContract(name: string, create: () => WenliAgentJobStore): void {
  describe(name, () => {
    it("creates once and returns defensive copies", async () => {
      const store = create();
      const first = await store.createIfAbsent(pendingJob);
      const second = await store.createIfAbsent({ ...pendingJob, requesterId: "1002" });

      expect(first).toEqual(pendingJob);
      expect(second).toEqual(pendingJob);
      first.status = "dead";
      await expect(store.get(pendingJob.id)).resolves.toEqual(pendingJob);
    });

    it("returns null for a missing job", async () => {
      await expect(create().get("missing")).resolves.toBeNull();
    });

    it("lists only due pending, retry, and expired running jobs in stable due order", async () => {
      const store = create();
      const now = "2026-08-30T01:00:00.000Z";
      const due = [
        { ...pendingJob, id: "1001_b", sourceMessageId: "1001_b", nextAttemptAt: now },
        { ...pendingJob, id: "1001_a", sourceMessageId: "1001_a", status: "retry" as const, nextAttemptAt: now },
        { ...pendingJob, id: "1001_running", sourceMessageId: "1001_running", status: "running" as const, leaseUntil: "2026-08-30T00:59:00.000Z" }
      ];
      for (const job of [...due,
        { ...pendingJob, id: "1001_future", sourceMessageId: "1001_future", nextAttemptAt: "2026-08-30T01:00:01.000Z" },
        { ...pendingJob, id: "1001_live", sourceMessageId: "1001_live", status: "running" as const, leaseUntil: "2026-08-30T01:00:01.000Z" },
        { ...pendingJob, id: "1001_done", sourceMessageId: "1001_done", status: "succeeded" as const }
      ]) await store.createIfAbsent(job);

      const listed = await store.listDue(now, 2);
      expect(listed.map((job) => job.id)).toEqual(["1001_running", "1001_a"]);
      listed[0]!.status = "dead";
      await expect(store.listDue(now, 5)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "1001_a", status: "retry" })]));
      await expect(store.listDue(now, 0)).rejects.toThrow("invalid Wenli");
      await expect(store.listDue("not-an-iso", 1)).rejects.toThrow("invalid Wenli argument");
    });
  });
}

jobStoreContract("MemoryWenliAgentJobStore", () => new MemoryWenliAgentJobStore());

describe("CloudBaseWenliAgentJobStore due query", () => {
  it("uses only the narrow due query and propagates its failures", async () => {
    const queryDueWenliAgentJobs = vi.fn(async () => [{ ...pendingJob, _id: pendingJob.id }]);
    const cloud = { queryDueWenliAgentJobs, getDocument: vi.fn(), putIfAbsent: vi.fn(), scanDocuments: vi.fn(() => { throw new Error("must not scan"); }) };
    const store = new CloudBaseWenliAgentJobStore(cloud as never);
    await expect(store.listDue("2026-08-30T00:00:00.000Z", 1)).resolves.toEqual([pendingJob]);
    expect(queryDueWenliAgentJobs).toHaveBeenCalledWith("2026-08-30T00:00:00.000Z", 1);
    await expect(new CloudBaseWenliAgentJobStore({ ...cloud, queryDueWenliAgentJobs: async () => { throw { code: "INTERNAL" }; } } as never).listDue("2026-08-30T00:00:00.000Z", 1)).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("validates due-query arguments before calling the CloudBase persistence port", async () => {
    const queryDueWenliAgentJobs = vi.fn(async () => [{ ...pendingJob }]);
    const store = new CloudBaseWenliAgentJobStore({ queryDueWenliAgentJobs, getDocument: vi.fn(), putIfAbsent: vi.fn() } as never);

    await expect(store.listDue("not-an-iso", 1)).rejects.toThrow("invalid Wenli argument");
    await expect(store.listDue("2026-08-30T00:00:00.000Z", 0)).rejects.toThrow("invalid Wenli argument");
    expect(queryDueWenliAgentJobs).not.toHaveBeenCalled();
  });
});
