import type {
  AccountId,
  ImageMessageFields,
  ImageMimeType,
  MomentCommentRecord,
  MomentLikeRecord,
  MomentRecord,
  MomentView,
  MomentVisibility
} from "../domain/contracts.js";
import { IMAGE_EXTENSION } from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import type { MomentStore } from "../ports/stores.js";

const CLIENT_ID = /^[A-Za-z0-9_-]{1,100}$/;
const IMAGE_MIME_TYPES = new Set<string>(Object.keys(IMAGE_EXTENSION));
const FEED_LIMIT = 50;

export class MomentService {
  constructor(
    private readonly moments: MomentStore,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async list(viewerId: AccountId): Promise<MomentView[]> {
    const latest = await this.moments.latestVisibleMoments(viewerId, FEED_LIMIT);
    const visible = latest.filter((moment) => !moment.deleting && canView(viewerId, moment));
    return this.viewsFor(visible);
  }

  async create(
    authorId: AccountId,
    clientMomentId: string,
    rawBody: string,
    visibilityValue: string,
    image?: ImageMessageFields
  ): Promise<MomentView> {
    if (!CLIENT_ID.test(clientMomentId)) {
      throw new AppError("MOMENT_ID_INVALID", "Moment ID is invalid");
    }
    const body = rawBody.trim();
    if (image !== undefined) {
      if ([...body].length > 2000) {
        throw new AppError("MOMENT_INVALID", "Moment text is too long");
      }
      validateMomentImage(image, authorId, clientMomentId);
    } else if ([...body].length < 1 || [...body].length > 2000) {
      throw new AppError("MOMENT_INVALID", "Moment text must contain 1 to 2000 characters");
    }
    if (visibilityValue !== "PARTNER" && visibilityValue !== "SELF") {
      throw new AppError("MOMENT_VISIBILITY_INVALID", "Moment visibility is invalid");
    }
    const visibility: MomentVisibility = visibilityValue;
    const id = `${authorId}_${clientMomentId}`;
    const existing = await this.moments.getMoment(id);
    if (existing) {
      const matching = matchingMoment(existing, {
        authorId,
        clientMomentId,
        body,
        visibility,
        ...(image === undefined ? {} : { image })
      });
      return (await this.viewsFor([matching]))[0]!;
    }

    const appended = await this.moments.appendMomentIfAbsent({
      id,
      authorId,
      clientMomentId,
      body,
      visibility,
      ...(image === undefined ? {} : image),
      createdAt: this.clock().toISOString(),
      deleting: false
    });
    const matching = matchingMoment(appended, {
      authorId,
      clientMomentId,
      body,
      visibility,
      ...(image === undefined ? {} : { image })
    });
    return (await this.viewsFor([matching]))[0]!;
  }

  async delete(authorId: AccountId, momentId: string): Promise<{ deleted: true }> {
    const existing = await this.moments.getMoment(momentId);
    if (!existing) return { deleted: true };

    if (existing.deleting) {
      if (existing.authorId !== authorId) return { deleted: true };
    } else {
      if (!canView(authorId, existing)) return { deleted: true };
      if (existing.authorId !== authorId) {
        throw new AppError("MOMENT_FORBIDDEN", "Only the post author may delete it");
      }
      await this.moments.markDeleting(momentId);
    }

    await this.moments.removeRelations(momentId);
    await this.moments.removeMoment(momentId);
    return { deleted: true };
  }

  async like(accountId: AccountId, momentId: string): Promise<MomentLikeRecord> {
    const like = await this.moments.appendLikeToVisibleMomentIfAbsent({
      id: `${momentId}_${accountId}`,
      momentId,
      accountId,
      createdAt: this.clock().toISOString()
    });
    if (!like) throw momentNotFound();
    return like;
  }

  async unlike(accountId: AccountId, momentId: string): Promise<{ unliked: true }> {
    await this.requireVisibleMoment(accountId, momentId);
    await this.moments.removeLike(`${momentId}_${accountId}`);
    return { unliked: true };
  }

  async comment(
    authorId: AccountId,
    momentId: string,
    clientCommentId: string,
    rawBody: string,
    replyToCommentId?: string
  ): Promise<MomentCommentRecord> {
    if (!CLIENT_ID.test(clientCommentId)) {
      throw new AppError("COMMENT_ID_INVALID", "Comment ID is invalid");
    }
    const body = normalizedText(rawBody, 500, "COMMENT_INVALID");
    if (replyToCommentId !== undefined) {
      await this.requireReplyTarget(authorId, momentId, replyToCommentId);
    }
    const id = `${authorId}_${clientCommentId}`;
    const expected = {
      momentId,
      authorId,
      clientCommentId,
      body,
      ...(replyToCommentId === undefined ? {} : { replyToCommentId })
    };
    const appended = await this.moments.appendCommentToVisibleMomentIfAbsent({
      id,
      ...expected,
      createdAt: this.clock().toISOString()
    });
    if (!appended) throw momentNotFound();
    return matchingComment(appended, expected);
  }

  async deleteComment(authorId: AccountId, commentId: string): Promise<{ deleted: true }> {
    const comment = await this.moments.getComment(commentId);
    if (!comment) return { deleted: true };
    const parent = await this.moments.getMoment(comment.momentId);
    if (!parent || parent.deleting || !canView(authorId, parent)) return { deleted: true };
    if (comment.authorId !== authorId) {
      throw new AppError("COMMENT_FORBIDDEN", "Only the comment author may delete it");
    }
    await this.moments.removeComment(commentId);
    return { deleted: true };
  }

  private async requireReplyTarget(
    authorId: AccountId,
    momentId: string,
    replyToCommentId: string
  ): Promise<void> {
    const replied = await this.moments.getComment(replyToCommentId);
    if (!replied || replied.momentId !== momentId) {
      throw new AppError("REPLY_COMMENT_INVALID", "被回复的评论不存在");
    }
    const parent = await this.moments.getMoment(momentId);
    if (!parent || parent.deleting || !canView(authorId, parent)) {
      throw momentNotFound();
    }
  }

  private async requireVisibleMoment(viewerId: AccountId, momentId: string): Promise<MomentRecord> {
    const moment = await this.moments.getMoment(momentId);
    if (!moment || moment.deleting || !canView(viewerId, moment)) {
      throw momentNotFound();
    }
    return moment;
  }

  private async viewsFor(records: MomentRecord[]): Promise<MomentView[]> {
    const momentIds = records.map((record) => record.id);
    const [likes, comments] = await Promise.all([
      this.moments.likesFor(momentIds),
      this.moments.commentsFor(momentIds)
    ]);
    const visibleIds = new Set(momentIds);
    const likesByMoment = groupByMoment(likes, visibleIds);
    const commentsByMoment = groupByMoment(comments, visibleIds);
    return records.map(({ deleting, ...record }) => {
      void deleting;
      return {
        ...record,
        likes: likesByMoment.get(record.id) ?? [],
        comments: commentsByMoment.get(record.id) ?? []
      };
    });
  }
}

function canView(viewerId: AccountId, moment: MomentRecord): boolean {
  return moment.visibility === "PARTNER" || moment.authorId === viewerId;
}

function momentNotFound(): AppError {
  return new AppError("MOMENT_NOT_FOUND", "Moment was not found");
}

function normalizedText(rawBody: string, maximum: number, code: string): string {
  const body = rawBody.trim();
  const length = [...body].length;
  if (length < 1 || length > maximum) {
    throw new AppError(code, `Text must contain 1 to ${maximum} characters`);
  }
  return body;
}

function matchingMoment(
  existing: MomentRecord,
  expected: Pick<MomentRecord, "authorId" | "clientMomentId" | "body" | "visibility"> & {
    image?: ImageMessageFields;
  }
): MomentRecord {
  if (
    existing.deleting ||
    existing.authorId !== expected.authorId ||
    existing.clientMomentId !== expected.clientMomentId ||
    existing.body !== expected.body ||
    existing.visibility !== expected.visibility ||
    (existing.imageFileId ?? null) !== (expected.image?.imageFileId ?? null)
  ) {
    throw new AppError("MOMENT_CONFLICT", "Moment ID conflicts with an existing post");
  }
  return existing;
}

function validateMomentImage(image: ImageMessageFields, authorId: AccountId, clientMomentId: string): void {
  const { imageFileId, imageMimeType, imageWidth, imageHeight } = image;
  if (!isImageMimeType(imageMimeType)) {
    throw new AppError("IMAGE_INVALID", "不支持的图片格式");
  }
  const expectedSuffix = `/moments-images/${authorId}_${clientMomentId}.${IMAGE_EXTENSION[imageMimeType]}`;
  if (!imageFileId.startsWith("cloud://") || !imageFileId.endsWith(expectedSuffix)) {
    throw new AppError("IMAGE_INVALID", "图片文件编号无效");
  }
  if ((imageWidth === undefined) !== (imageHeight === undefined)) {
    throw new AppError("IMAGE_INVALID", "图片尺寸无效");
  }
  for (const dimension of [imageWidth, imageHeight]) {
    if (dimension !== undefined && (!Number.isInteger(dimension) || dimension < 1 || dimension > 20000)) {
      throw new AppError("IMAGE_INVALID", "图片尺寸无效");
    }
  }
}

function isImageMimeType(value: string): value is ImageMimeType {
  return IMAGE_MIME_TYPES.has(value);
}

function matchingComment(
  existing: MomentCommentRecord,
  expected: Pick<MomentCommentRecord, "momentId" | "authorId" | "clientCommentId" | "body"> & {
    replyToCommentId?: string;
  }
): MomentCommentRecord {
  if (
    existing.momentId !== expected.momentId ||
    existing.authorId !== expected.authorId ||
    existing.clientCommentId !== expected.clientCommentId ||
    existing.body !== expected.body ||
    existing.replyToCommentId !== expected.replyToCommentId
  ) {
    throw new AppError("COMMENT_CONFLICT", "Comment ID conflicts with an existing comment");
  }
  return existing;
}

function compareCreatedAtAndId(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function groupByMoment<T extends { momentId: string; createdAt: string; id: string }>(
  relations: T[],
  visibleIds: ReadonlySet<string>
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const relation of [...relations].sort(compareCreatedAtAndId)) {
    if (!visibleIds.has(relation.momentId)) continue;
    const existing = grouped.get(relation.momentId);
    if (existing) existing.push(relation);
    else grouped.set(relation.momentId, [relation]);
  }
  return grouped;
}
