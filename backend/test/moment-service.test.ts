import { beforeEach, describe, expect, it } from "vitest";
import { MemoryMomentStore } from "../src/adapters/memory-stores.js";
import type { MomentCommentRecord, MomentLikeRecord } from "../src/domain/contracts.js";
import { MomentService } from "../src/services/moment-service.js";

describe("MomentService", () => {
  let moments: MemoryMomentStore;
  let now: Date;
  let service: MomentService;

  beforeEach(() => {
    moments = new MemoryMomentStore();
    now = new Date("2026-08-07T00:00:00.000Z");
    service = new MomentService(moments, () => new Date(now));
  });

  it("shows PARTNER moments to both accounts and SELF moments only to their author", async () => {
    await service.create("1001", "shared-her", "shared by her", "PARTNER");
    await service.create("1002", "shared-him", "shared by him", "PARTNER");
    await service.create("1001", "private-her", "private by her", "SELF");
    await service.create("1002", "private-him", "private by him", "SELF");

    expect((await service.list("1001")).map((moment) => moment.id).sort()).toEqual([
      "1001_private-her",
      "1001_shared-her",
      "1002_shared-him"
    ]);
    expect((await service.list("1002")).map((moment) => moment.id).sort()).toEqual([
      "1001_shared-her",
      "1002_private-him",
      "1002_shared-him"
    ]);
  });

  it("validates and trims creation input while making matching retries idempotent", async () => {
    const created = await service.create("1001", "retry_1", "  hello world  ", "PARTNER");
    now = new Date("2026-08-07T01:00:00.000Z");

    await expect(service.create("1001", "retry_1", "hello world", "PARTNER")).resolves.toEqual(created);
    await expect(service.create("1001", "retry_1", "different", "PARTNER")).rejects.toMatchObject({
      code: "MOMENT_CONFLICT"
    });
    await expect(service.create("1001", "retry_1", "hello world", "SELF")).rejects.toMatchObject({
      code: "MOMENT_CONFLICT"
    });
    await expect(service.create("1001", "empty", " \n ", "PARTNER")).rejects.toMatchObject({
      code: "MOMENT_INVALID"
    });
    await expect(service.create("1001", "large", "x".repeat(2001), "PARTNER")).rejects.toMatchObject({
      code: "MOMENT_INVALID"
    });
    await expect(service.create("1001", "bad/id", "hello", "PARTNER")).rejects.toMatchObject({
      code: "MOMENT_ID_INVALID"
    });
    await expect(service.create("1001", "valid", "hello", "FRIENDS")).rejects.toMatchObject({
      code: "MOMENT_VISIBILITY_INVALID"
    });
    await expect(service.create("1001", "unicode-max", "\u{1F642}".repeat(2000), "SELF")).resolves.toMatchObject({
      body: "\u{1F642}".repeat(2000)
    });

    expect(await service.list("1001")).toHaveLength(2);
  });

  it("returns a public aggregate view from create and refreshes relations on a retry", async () => {
    const created = await service.create("1001", "aggregate", "post", "PARTNER");

    expect(created).not.toHaveProperty("deleting");
    expect(created).toMatchObject({ likes: [], comments: [] });

    const like = await service.like("1002", created.id);
    const comment = await service.comment("1002", created.id, "aggregate-comment", "hello");
    await expect(service.create("1001", "aggregate", "post", "PARTNER")).resolves.toEqual({
      ...created,
      likes: [like],
      comments: [comment]
    });
  });

  it("creates and reads back an image moment with validated metadata", async () => {
    const created = await service.create("1001", "img-moment", "", "PARTNER", {
      imageFileId: "cloud://env-bucket/moments-images/1001_img-moment.jpg",
      imageMimeType: "image/jpeg",
      imageWidth: 800,
      imageHeight: 600
    });
    expect(created).toMatchObject({
      id: "1001_img-moment",
      imageFileId: "cloud://env-bucket/moments-images/1001_img-moment.jpg",
      imageWidth: 800,
      imageHeight: 600
    });
    expect((await service.list("1002")).some((moment) => moment.id === "1001_img-moment")).toBe(true);
  });

  it("rejects image moments with a foreign file id or partial dimensions", async () => {
    await expect(service.create("1001", "bad-1", "", "PARTNER", {
      imageFileId: "cloud://env-bucket/moments-images/1002_bad-1.jpg",
      imageMimeType: "image/jpeg"
    })).rejects.toMatchObject({ code: "IMAGE_INVALID" });
    await expect(service.create("1001", "bad-2", "", "PARTNER", {
      imageFileId: "cloud://env-bucket/moments-images/1001_bad-2.jpg",
      imageMimeType: "image/jpeg",
      imageWidth: 800
    })).rejects.toMatchObject({ code: "IMAGE_INVALID" });
  });

  it("lets only the author delete a post, preserves a failed cleanup marker, and resumes safely", async () => {
    const failingStore = new FailOnceCleanupMomentStore();
    const deletingService = new MomentService(failingStore, () => new Date(now));
    const post = await deletingService.create("1001", "delete-me", "post", "PARTNER");
    await deletingService.like("1001", post.id);
    await deletingService.like("1002", post.id);
    await deletingService.comment("1001", post.id, "comment-her", "her comment");
    await deletingService.comment("1002", post.id, "comment-him", "his comment");

    await expect(deletingService.delete("1002", post.id)).rejects.toMatchObject({ code: "MOMENT_FORBIDDEN" });
    await expect(deletingService.delete("1001", post.id)).rejects.toThrow("cleanup failed");
    await expect(failingStore.getMoment(post.id)).resolves.toMatchObject({ deleting: true });
    await expect(deletingService.list("1001")).resolves.toEqual([]);
    await expect(deletingService.like("1001", post.id)).rejects.toMatchObject({ code: "MOMENT_NOT_FOUND" });

    await expect(deletingService.delete("1001", post.id)).resolves.toEqual({ deleted: true });
    await expect(failingStore.getMoment(post.id)).resolves.toBeNull();
    await expect(failingStore.likesFor([post.id])).resolves.toEqual([]);
    await expect(failingStore.commentsFor([post.id])).resolves.toEqual([]);
    await expect(deletingService.delete("1001", post.id)).resolves.toEqual({ deleted: true });
  });

  it("keeps one like per account and treats like and unlike retries idempotently", async () => {
    const post = await service.create("1001", "liked", "post", "PARTNER");

    const first = await service.like("1002", post.id);
    now = new Date("2026-08-07T01:00:00.000Z");
    await expect(service.like("1002", post.id)).resolves.toEqual(first);
    await expect(moments.likesFor([post.id])).resolves.toEqual([first]);
    await expect(service.unlike("1002", post.id)).resolves.toEqual({ unliked: true });
    await expect(service.unlike("1002", post.id)).resolves.toEqual({ unliked: true });
    await expect(moments.likesFor([post.id])).resolves.toEqual([]);
  });

  it("makes comments idempotent, rejects conflicts, and allows only the comment author to delete", async () => {
    const post = await service.create("1001", "comments", "post", "PARTNER");
    const otherPost = await service.create("1001", "other", "other post", "PARTNER");
    const comment = await service.comment("1002", post.id, "comment_1", "  hello  ");
    now = new Date("2026-08-07T01:00:00.000Z");

    await expect(service.comment("1002", post.id, "comment_1", "hello")).resolves.toEqual(comment);
    await expect(service.comment("1002", post.id, "comment_1", "different")).rejects.toMatchObject({
      code: "COMMENT_CONFLICT"
    });
    await expect(service.comment("1002", otherPost.id, "comment_1", "hello")).rejects.toMatchObject({
      code: "COMMENT_CONFLICT"
    });
    await expect(service.comment("1002", post.id, "empty", " \n ")).rejects.toMatchObject({
      code: "COMMENT_INVALID"
    });
    await expect(service.comment("1002", post.id, "large", "x".repeat(501))).rejects.toMatchObject({
      code: "COMMENT_INVALID"
    });
    await expect(service.comment("1002", post.id, "bad/id", "hello")).rejects.toMatchObject({
      code: "COMMENT_ID_INVALID"
    });
    await expect(service.comment("1002", post.id, "unicode-max", "\u{1F642}".repeat(500))).resolves.toMatchObject({
      body: "\u{1F642}".repeat(500)
    });

    await expect(service.deleteComment("1001", comment.id)).rejects.toMatchObject({ code: "COMMENT_FORBIDDEN" });
    await expect(service.deleteComment("1002", comment.id)).resolves.toEqual({ deleted: true });
    await expect(service.deleteComment("1002", comment.id)).resolves.toEqual({ deleted: true });
  });

  it("supports replying to a comment and rejects cross-moment or missing targets", async () => {
    const post = await service.create("1001", "reply-post", "post", "PARTNER");
    const otherPost = await service.create("1001", "reply-other", "other", "PARTNER");
    const original = await service.comment("1001", post.id, "reply-root", "original");
    const second = await service.comment("1002", post.id, "reply-second-root", "second");
    const other = await service.comment("1002", otherPost.id, "reply-other-root", "other comment");

    const reply = await service.comment("1002", post.id, "reply-child", "replying", original.id);
    expect(reply.replyToCommentId).toBe(original.id);

    // 幂等重试：同 id + 同回复目标 → 返回原记录
    await expect(
      service.comment("1002", post.id, "reply-child", "replying", original.id)
    ).resolves.toEqual(reply);
    // 同 id 但回复目标变了（同一动态上的另一条合法评论）→ 冲突
    await expect(service.comment("1002", post.id, "reply-child", "replying", second.id)).rejects.toMatchObject({
      code: "COMMENT_CONFLICT"
    });
    // 回复目标不存在
    await expect(service.comment("1002", post.id, "reply-missing", "x", "1001_nonexistent")).rejects.toMatchObject({
      code: "REPLY_COMMENT_INVALID"
    });
    // 回复目标属于另一条动态
    await expect(service.comment("1002", post.id, "reply-cross", "x", other.id)).rejects.toMatchObject({
      code: "REPLY_COMMENT_INVALID"
    });
    // 无回复目标时仍普通评论
    const plain = await service.comment("1002", post.id, "reply-plain", "plain");
    expect(plain).not.toHaveProperty("replyToCommentId");
  });

  it("rejects interactions with invisible or deleting posts without returning their data", async () => {
    const hidden = await service.create("1001", "hidden", "private data", "SELF");

    await expect(service.like("1002", hidden.id)).rejects.toMatchObject({ code: "MOMENT_NOT_FOUND" });
    await expect(service.unlike("1002", hidden.id)).rejects.toMatchObject({ code: "MOMENT_NOT_FOUND" });
    await expect(service.comment("1002", hidden.id, "hidden-comment", "hello")).rejects.toMatchObject({
      code: "MOMENT_NOT_FOUND"
    });

    await moments.markDeleting(hidden.id);
    await expect(service.like("1001", hidden.id)).rejects.toMatchObject({ code: "MOMENT_NOT_FOUND" });
    await expect(service.unlike("1001", hidden.id)).rejects.toMatchObject({ code: "MOMENT_NOT_FOUND" });
    await expect(service.comment("1001", hidden.id, "deleting-comment", "hello")).rejects.toMatchObject({
      code: "MOMENT_NOT_FOUND"
    });
    await expect(service.list("1001")).resolves.toEqual([]);
  });

  it("returns at most the 50 newest moments with stable createdAt and id ordering", async () => {
    for (let index = 0; index < 52; index += 1) {
      await service.create("1001", `m-${String(index).padStart(2, "0")}`, `post ${index}`, "PARTNER");
    }

    const feed = await service.list("1002");
    expect(feed).toHaveLength(50);
    expect(feed.map((moment) => moment.clientMomentId)).toEqual(
      Array.from({ length: 50 }, (_, index) => `m-${String(51 - index).padStart(2, "0")}`)
    );

    const newest = feed[0]!;
    expect(newest).not.toHaveProperty("deleting");
    expect(newest).toMatchObject({ likes: [], comments: [] });
  });

  it("applies visibility before the feed limit so hidden newer posts cannot crowd out a shared post", async () => {
    const shared = await service.create("1001", "older-shared", "shared", "PARTNER");
    for (let index = 0; index < 50; index += 1) {
      now = new Date(now.getTime() + 1_000);
      await service.create("1002", `newer-hidden-${index}`, `hidden ${index}`, "SELF");
    }

    await expect(service.list("1001")).resolves.toEqual([shared]);
  });

  it("sorts likes and comments deterministically inside each visible view", async () => {
    const post = await service.create("1001", "relations", "post", "PARTNER");
    await service.like("1002", post.id);
    await service.like("1001", post.id);
    await service.comment("1002", post.id, "comment", "second id");
    await service.comment("1001", post.id, "comment", "first id");

    const [view] = await service.list("1001");
    expect(view?.likes.map((like) => like.accountId)).toEqual(["1001", "1002"]);
    expect(view?.comments.map((comment) => comment.authorId)).toEqual(["1001", "1002"]);
  });

  it("loads relations once per list call using only visible moment IDs", async () => {
    const countingStore = new CountingMomentStore();
    const countingService = new MomentService(countingStore, () => new Date(now));
    const sharedHer = await countingService.create("1001", "shared-her", "post", "PARTNER");
    const sharedHim = await countingService.create("1002", "shared-him", "post", "PARTNER");
    await countingService.create("1001", "hidden-her", "private", "SELF");
    countingStore.resetCounts();

    await countingService.list("1002");

    const visibleIds = [sharedHim.id, sharedHer.id];
    expect(countingStore.likeBatches).toEqual([visibleIds]);
    expect(countingStore.commentBatches).toEqual([visibleIds]);
  });

  it("batches and stably sorts memory relations and marks deletion without returning internal data", async () => {
    const first = await service.create("1001", "batch-a", "first", "PARTNER");
    const second = await service.create("1002", "batch-b", "second", "PARTNER");
    const excluded = await service.create("1001", "batch-hidden", "excluded", "SELF");
    const secondLike = await service.like("1002", second.id);
    const firstLike = await service.like("1001", first.id);
    await service.like("1001", excluded.id);
    const secondComment = await service.comment("1002", second.id, "batch-second", "second");
    const firstComment = await service.comment("1001", first.id, "batch-first", "first");
    await service.comment("1001", excluded.id, "batch-excluded", "excluded");

    await expect(moments.likesFor([second.id, first.id])).resolves.toEqual([firstLike, secondLike]);
    await expect(moments.commentsFor([second.id, first.id])).resolves.toEqual([firstComment, secondComment]);
    await expect(moments.markDeleting(first.id)).resolves.toBeUndefined();
    await expect(moments.getMoment(first.id)).resolves.toMatchObject({ deleting: true });
  });

  it("does not leave a like behind when deletion wins the atomic store race", async () => {
    const racingStore = new DelayedLikeStore();
    const racingService = new MomentService(racingStore, () => new Date(now));
    const post = await racingService.create("1001", "like-race", "post", "PARTNER");

    const outcomePromise = racingService.like("1002", post.id).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await racingStore.gate.entered;
    await racingService.delete("1001", post.id);
    racingStore.gate.open();

    await expect(outcomePromise).resolves.toMatchObject({ error: { code: "MOMENT_NOT_FOUND" } });
    await expect(racingStore.likesFor([post.id])).resolves.toEqual([]);
  });

  it("does not leave a comment behind when deletion wins the atomic store race", async () => {
    const racingStore = new DelayedCommentStore();
    const racingService = new MomentService(racingStore, () => new Date(now));
    const post = await racingService.create("1001", "comment-race", "post", "PARTNER");

    const outcomePromise = racingService.comment("1002", post.id, "racing-comment", "hello").then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await racingStore.gate.entered;
    await racingService.delete("1001", post.id);
    racingStore.gate.open();

    await expect(outcomePromise).resolves.toMatchObject({ error: { code: "MOMENT_NOT_FOUND" } });
    await expect(racingStore.commentsFor([post.id])).resolves.toEqual([]);
  });

  it("cleans up interactions that win before the deletion marker", async () => {
    const racingStore = new DelayedMarkStore();
    const racingService = new MomentService(racingStore, () => new Date(now));
    const post = await racingService.create("1001", "delete-race", "post", "PARTNER");
    racingStore.arm();

    const deletion = racingService.delete("1001", post.id);
    await racingStore.gate.entered;
    await racingService.like("1002", post.id);
    await racingService.comment("1002", post.id, "before-marker", "hello");
    racingStore.gate.open();

    await expect(deletion).resolves.toEqual({ deleted: true });
    await expect(racingStore.likesFor([post.id])).resolves.toEqual([]);
    await expect(racingStore.commentsFor([post.id])).resolves.toEqual([]);
  });

  it("keeps the marker invisible and retries cleanup after post removal fails", async () => {
    const failingStore = new FailOnceRemoveMomentStore();
    const deletingService = new MomentService(failingStore, () => new Date(now));
    const post = await deletingService.create("1001", "remove-failure", "post", "PARTNER");
    await deletingService.like("1002", post.id);
    await deletingService.comment("1002", post.id, "remove-failure-comment", "hello");

    await expect(deletingService.delete("1001", post.id)).rejects.toThrow("remove failed");
    await expect(failingStore.getMoment(post.id)).resolves.toMatchObject({ deleting: true });
    await expect(failingStore.likesFor([post.id])).resolves.toEqual([]);
    await expect(failingStore.commentsFor([post.id])).resolves.toEqual([]);
    await expect(deletingService.list("1001")).resolves.toEqual([]);

    await expect(deletingService.delete("1001", post.id)).resolves.toEqual({ deleted: true });
    await expect(failingStore.getMoment(post.id)).resolves.toBeNull();
  });

  it("makes missing, invisible, and deleting post deletes indistinguishable", async () => {
    const hidden = await service.create("1001", "private-delete", "private", "SELF");
    const shared = await service.create("1001", "shared-delete", "shared", "PARTNER");
    const missingResult = await service.delete("1002", "missing-post");

    await expect(service.delete("1002", hidden.id)).resolves.toEqual(missingResult);
    await moments.markDeleting(hidden.id);
    await expect(service.delete("1002", hidden.id)).resolves.toEqual(missingResult);
    await expect(service.delete("1002", shared.id)).rejects.toMatchObject({ code: "MOMENT_FORBIDDEN" });
  });

  it("makes comments on unavailable parents look absent but protects visible partner comments", async () => {
    const hidden = await service.create("1001", "private-comments", "private", "SELF");
    const hiddenComment = await service.comment("1001", hidden.id, "private-comment", "private");
    const missingResult = await service.deleteComment("1002", "missing-comment");
    await expect(service.deleteComment("1002", hiddenComment.id)).resolves.toEqual(missingResult);

    await moments.markDeleting(hidden.id);
    await expect(service.deleteComment("1001", hiddenComment.id)).resolves.toEqual(missingResult);

    const orphanParent = await service.create("1001", "orphan-parent", "post", "PARTNER");
    const orphan = await service.comment("1001", orphanParent.id, "orphan-comment", "hello");
    await moments.removeMoment(orphanParent.id);
    await expect(service.deleteComment("1001", orphan.id)).resolves.toEqual(missingResult);

    const shared = await service.create("1001", "shared-comments", "post", "PARTNER");
    const protectedComment = await service.comment("1001", shared.id, "protected-comment", "hello");
    await expect(service.deleteComment("1002", protectedComment.id)).rejects.toMatchObject({
      code: "COMMENT_FORBIDDEN"
    });
  });
});

class FailOnceCleanupMomentStore extends MemoryMomentStore {
  private shouldFail = true;

  override async removeRelations(momentId: string): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error("cleanup failed");
    }
    await super.removeRelations(momentId);
  }
}

class CountingMomentStore extends MemoryMomentStore {
  readonly likeBatches: string[][] = [];
  readonly commentBatches: string[][] = [];

  override async likesFor(momentIds: string[]): Promise<MomentLikeRecord[]> {
    this.likeBatches.push([...momentIds]);
    return super.likesFor(momentIds);
  }

  override async commentsFor(momentIds: string[]): Promise<MomentCommentRecord[]> {
    this.commentBatches.push([...momentIds]);
    return super.commentsFor(momentIds);
  }

  resetCounts(): void {
    this.likeBatches.length = 0;
    this.commentBatches.length = 0;
  }
}

// These gates model why a Cloud store must combine post availability checks and relation inserts in one transaction.
class AsyncGate {
  readonly entered: Promise<void>;
  private readonly signalEntered: () => void;
  private readonly released: Promise<void>;
  private readonly release: () => void;

  constructor() {
    let signalEntered!: () => void;
    let release!: () => void;
    this.entered = new Promise((resolve) => {
      signalEntered = resolve;
    });
    this.released = new Promise((resolve) => {
      release = resolve;
    });
    this.signalEntered = signalEntered;
    this.release = release;
  }

  async pause(): Promise<void> {
    this.signalEntered();
    await this.released;
  }

  open(): void {
    this.release();
  }
}

class DelayedLikeStore extends MemoryMomentStore {
  readonly gate = new AsyncGate();

  override async appendLikeToVisibleMomentIfAbsent(like: MomentLikeRecord): Promise<MomentLikeRecord | null> {
    await this.gate.pause();
    return super.appendLikeToVisibleMomentIfAbsent(like);
  }
}

class DelayedCommentStore extends MemoryMomentStore {
  readonly gate = new AsyncGate();

  override async appendCommentToVisibleMomentIfAbsent(
    comment: MomentCommentRecord
  ): Promise<MomentCommentRecord | null> {
    await this.gate.pause();
    return super.appendCommentToVisibleMomentIfAbsent(comment);
  }
}

class DelayedMarkStore extends MemoryMomentStore {
  readonly gate = new AsyncGate();
  private armed = false;

  arm(): void {
    this.armed = true;
  }

  override async markDeleting(momentId: string): Promise<void> {
    if (this.armed) {
      this.armed = false;
      await this.gate.pause();
    }
    await super.markDeleting(momentId);
  }
}

class FailOnceRemoveMomentStore extends MemoryMomentStore {
  private shouldFail = true;

  override async removeMoment(momentId: string): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error("remove failed");
    }
    await super.removeMoment(momentId);
  }
}
