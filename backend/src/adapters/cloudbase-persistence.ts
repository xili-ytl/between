import type { CloudBase } from "@cloudbase/node-sdk";
import { FIXED_ACCOUNT_IDS } from "../domain/contracts.js";
import { compareMessageCursors, type AccountId, type MessageCursor } from "../domain/contracts.js";
import { assertLegacyReadStateForward } from "../domain/read-state.js";
import type { CloudPersistence, DocumentData } from "./cloudbase-stores.js";
import type { InitialProfilesFields, LoginAttemptRecord, LoginFailurePolicy, StoredDocument, UploadMetadata } from "../ports/stores.js";
import { cleanDocument, firstDocument, queryDueWenliAgentJobDocuments, readDocument, setDocument, throwResolvedCloudBaseError, type CloudDatabase, type CloudTransaction } from "./cloudbase-sdk-helpers.js";

type CloudCollection = ReturnType<CloudDatabase["collection"]>;
type CloudQuery = ReturnType<CloudCollection["where"]>;

export class NodeCloudBasePersistence implements CloudPersistence {
  private readonly db: CloudDatabase;

  constructor(private readonly app: CloudBase) {
    this.db = app.database();
  }

  async getDocument(collection: string, id: string): Promise<DocumentData | null> {
    return readDocument(this.db.collection(collection).doc(id));
  }

  async findOne(collection: string, equality: Record<string, unknown>): Promise<DocumentData | null> {
    const result = await this.db.collection(collection).where(equality).limit(1).get();
    throwResolvedCloudBaseError(result);
    return cleanDocument(result.data[0]);
  }

  async putDocument(collection: string, id: string, data: DocumentData): Promise<void> {
    await setDocument(this.db.collection(collection).doc(id), data);
  }

  async recordLoginFailure(id: string, policy: LoginFailurePolicy): Promise<LoginAttemptRecord> {
    // The SDK retries conflicts; a threshold-sized burst needs up to that many retries.
    return this.db.runTransaction(async (transaction: CloudTransaction) => {
      const reference = transaction.collection("login_attempts").doc(id);
      const result = await reference.get();
      throwResolvedCloudBaseError(result);
      const latest = cleanDocument(firstDocument(result.data));
      const now = Date.parse(policy.now);
      const blockedUntil = latest?.blockedUntil;
      if (typeof blockedUntil === "string" && Date.parse(blockedUntil) > now) {
        return { failures: numberValue(latest!.failures), blockedUntil };
      }
      const failures = (blockedUntil ? 0 : latest ? numberValue(latest.failures) : 0) + 1;
      const record: LoginAttemptRecord = {
        failures,
        blockedUntil: failures >= policy.maxFailures
          ? new Date(now + policy.blockMilliseconds).toISOString()
          : null
      };
      const setResult = await reference.set({ ...record });
      throwResolvedCloudBaseError(setResult);
      return record;
    }, policy.maxFailures);
  }

  async removeDocument(collection: string, id: string): Promise<void> {
    const result = await this.db.collection(collection).doc(id).remove();
    throwResolvedCloudBaseError(result);
  }

  async putIfAbsent(collection: string, id: string, data: DocumentData): Promise<DocumentData> {
    return (await this.putIfAbsentWithStatus(collection, id, data)).document;
  }

  async putIfAbsentWithStatus(
    collection: string,
    id: string,
    data: DocumentData
  ): Promise<{ document: DocumentData; inserted: boolean }> {
    return this.db.runTransaction(async (transaction: CloudTransaction) => {
      const reference = transaction.collection(collection).doc(id);
      const result = await reference.get();
      throwResolvedCloudBaseError(result);
      const existing = cleanDocument(firstDocument(result.data));
      if (existing) return { document: existing, inserted: false };
      const setResult = await reference.set(data);
      throwResolvedCloudBaseError(setResult);
      return { document: structuredClone(data), inserted: true };
    });
  }

  async initializeUserProfilesIfNeeded(
    fields: InitialProfilesFields
  ): Promise<{ documents: DocumentData[] | null; initializedAccounts: AccountId[] }> {
    return this.db.runTransaction(async (transaction: CloudTransaction) => {
      const references = FIXED_ACCOUNT_IDS.map((accountId) => transaction.collection("users").doc(accountId));
      const latest: Array<DocumentData | null> = [];
      for (const reference of references) {
        const result = await reference.get();
        throwResolvedCloudBaseError(result);
        latest.push(cleanDocument(firstDocument(result.data)));
      }
      if (latest.some((document) => !document)) return { documents: null, initializedAccounts: [] };
      const initializedAccounts: AccountId[] = [];
      const documents = FIXED_ACCOUNT_IDS.map((accountId, index) => {
        const document = latest[index]!;
        if (typeof document.profileInitializedVersion === "number" && document.profileInitializedVersion >= 1) {
          return document;
        }
        initializedAccounts.push(accountId);
        return { ...document, ...fields[accountId], profileInitializedVersion: 1 };
      });
      for (const [index, accountId] of FIXED_ACCOUNT_IDS.entries()) {
        if (initializedAccounts.includes(accountId)) {
          const result = await references[index]!.set(documents[index]!);
          throwResolvedCloudBaseError(result);
        }
      }
      return { documents: structuredClone(documents), initializedAccounts };
    });
  }

  async patchUserDocument(
    accountId: AccountId,
    fields: DocumentData,
    incrementSessionVersion: boolean
  ): Promise<DocumentData | null> {
    return this.db.runTransaction(async (transaction: CloudTransaction) => {
      const reference = transaction.collection("users").doc(accountId);
      const result = await reference.get();
      throwResolvedCloudBaseError(result);
      const latest = cleanDocument(firstDocument(result.data));
      if (!latest) return null;
      const patch = incrementSessionVersion
        ? { ...fields, sessionVersion: numberValue(latest.sessionVersion) + 1 }
        : fields;
      const updateResult = await reference.update(patch);
      throwResolvedCloudBaseError(updateResult);
      return { ...latest, ...patch };
    });
  }

  async queryMessages(
    direction: "after" | "before",
    cursor: MessageCursor | null,
    limit: number
  ): Promise<DocumentData[]> {
    const command = this.db.command;
    const operator = direction === "after" ? command.gt : command.lt;
    const order = direction === "after" ? "asc" : "desc";
    let query: CloudQuery = this.db.collection("messages");
    if (cursor) {
      query = query.where(command.or([
        { createdAt: operator(cursor.createdAt) },
        { createdAt: cursor.createdAt, id: operator(cursor.id) }
      ]));
    }
    const result = await query
      .orderBy("createdAt", order)
      .orderBy("id", order)
      .limit(limit)
      .get();
    throwResolvedCloudBaseError(result);
    return result.data.map((document) => cleanDocument(document)!).filter(Boolean);
  }

  async queryPendingWenliMentionIds(afterId: string | null, limit: number): Promise<string[]> {
    const result = await this.db.collection("messages")
      .where({
        wenliMentionPending: true,
        ...(afterId === null ? {} : { _id: this.db.command.gt(afterId) })
      })
      .orderBy("_id", "asc")
      .limit(limit)
      .get();
    throwResolvedCloudBaseError(result);
    // The document key, not a possibly malformed payload id, drives cyclic pagination.
    return result.data.map((document) => document._id);
  }

  async advanceReadState(
    accountId: AccountId,
    cursor: MessageCursor,
    updatedAt: string
  ): Promise<DocumentData> {
    return this.db.runTransaction(async (transaction: CloudTransaction) => {
      const reference = transaction.collection("readStates").doc(accountId);
      const result = await reference.get();
      throwResolvedCloudBaseError(result);
      const existing = cleanDocument(firstDocument(result.data));
      const existingCursor = existing &&
        typeof existing.readReceiptMessageId === "string" &&
        typeof existing.readReceiptMessageCreatedAt === "string"
        ? {
            id: existing.readReceiptMessageId,
            createdAt: existing.readReceiptMessageCreatedAt
          }
        : null;
      if (existingCursor && compareMessageCursors(cursor, existingCursor) <= 0) return existing;

      const patch = {
        readReceiptMessageId: cursor.id,
        readReceiptMessageCreatedAt: cursor.createdAt,
        updatedAt
      };
      if (!existing) {
        const setResult = await reference.set({ accountId, ...patch });
        throwResolvedCloudBaseError(setResult);
        return { accountId, ...patch };
      }
      const updateResult = await reference.update(patch);
      throwResolvedCloudBaseError(updateResult);
      return { ...existing, ...patch };
    });
  }

  async patchReadState(
    accountId: AccountId,
    patch: DocumentData,
    updatedAt: string
  ): Promise<DocumentData> {
    return this.db.runTransaction(async (transaction: CloudTransaction) => {
      const reference = transaction.collection("readStates").doc(accountId);
      const result = await reference.get();
      throwResolvedCloudBaseError(result);
      const existing = cleanDocument(firstDocument(result.data));
      if (existing) assertLegacyReadStateForward(existing, patch);
      const update = { ...patch, updatedAt };
      if (!existing) {
        const setResult = await reference.set({ accountId, ...update });
        throwResolvedCloudBaseError(setResult);
        return { accountId, ...update };
      }
      const updateResult = await reference.update(update);
      throwResolvedCloudBaseError(updateResult);
      return { ...existing, ...update };
    });
  }

  async queryDueWenliAgentJobs(now: string, limit: number): Promise<DocumentData[]> {
    return queryDueWenliAgentJobDocuments(this.db, now, limit);
  }

  async acknowledgeWenliMention(messageId: string): Promise<void> {
    const result = await this.db.collection("messages")
      .where({ _id: messageId, wenliMentionPending: true })
      .update({ wenliMentionPending: false });
    throwResolvedCloudBaseError(result);
  }

  async queryLatestVisibleMoments(viewerId: AccountId, limit: number): Promise<DocumentData[]> {
    const command = this.db.command;
    const visibility = command.or([
      { visibility: "PARTNER" },
      { authorId: viewerId }
    ]);
    const result = await this.db.collection("moments")
      .where(command.and([{ deleting: false }, visibility]))
      .orderBy("createdAt", "desc")
      .orderBy("id", "desc")
      .limit(limit)
      .get();
    throwResolvedCloudBaseError(result);
    return result.data.map((document) => cleanDocument(document)!).filter(Boolean);
  }

  async queryWenliMemories(limit: number): Promise<StoredDocument[]> {
    const result = await this.db.collection("wenliMemories")
      .orderBy("updatedAt", "desc")
      .orderBy("_id", "desc")
      .limit(Math.min(limit, 200))
      .get();
    throwResolvedCloudBaseError(result);
    return result.data.flatMap((value) => {
      if (typeof value !== "object" || value === null || typeof value._id !== "string") return [];
      const data = cleanDocument(value);
      return data ? [{ id: value._id, data }] : [];
    });
  }

  async queryMomentRelations(
    collection: "momentLikes" | "momentComments",
    momentIds: string[],
    limit?: number
  ): Promise<DocumentData[]> {
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || momentIds.length > 10) {
        throw new Error("invalid relation context limit");
      }
      if (!momentIds.length) return [];
      const result = await this.db.collection(collection)
        .where({ momentId: this.db.command.in(momentIds) })
        .orderBy("createdAt", "desc")
        .orderBy("id", "desc")
        .limit(limit)
        .get();
      throwResolvedCloudBaseError(result);
      return result.data.map((document) => cleanDocument(document)!).filter(Boolean).slice(0, limit);
    }
    const chunks: string[][] = [];
    for (let index = 0; index < momentIds.length; index += 10) {
      chunks.push(momentIds.slice(index, index + 10));
    }
    const results = await Promise.all(chunks.map(async (chunk) => {
      const documents: DocumentData[] = [];
      const reference = this.db.collection(collection);
      const condition = { momentId: this.db.command.in(chunk) };
      for (let offset = 0; ; offset += 100) {
        // Task 12 provisions the compound momentId/createdAt/id indexes required by this stable page order.
        const result = await reference.where(condition)
          .orderBy("createdAt", "asc")
          .orderBy("id", "asc")
          .skip(offset)
          .limit(100)
          .get();
        throwResolvedCloudBaseError(result);
        documents.push(...result.data.map((document) => cleanDocument(document)!).filter(Boolean));
        if (result.data.length < 100) break;
      }
      return documents;
    }));
    return results.flat();
  }

  async removeMomentRelations(momentId: string): Promise<void> {
    const likeResult = await this.db.collection("momentLikes").where({ momentId }).remove();
    throwResolvedCloudBaseError(likeResult);
    const commentResult = await this.db.collection("momentComments").where({ momentId }).remove();
    throwResolvedCloudBaseError(commentResult);
  }

  async appendMomentRelationIfVisible(
    collection: "momentLikes" | "momentComments",
    relationId: string,
    momentId: string,
    actorId: AccountId,
    data: DocumentData
  ): Promise<DocumentData | null> {
    return this.db.runTransaction(async (transaction: CloudTransaction) => {
      const momentReference = transaction.collection("moments").doc(momentId);
      const momentResult = await momentReference.get();
      throwResolvedCloudBaseError(momentResult);
      const moment = cleanDocument(firstDocument(momentResult.data));
      if (!moment || moment.deleting !== false) return null;
      const visible = moment.visibility === "PARTNER" ||
        (moment.visibility === "SELF" && moment.authorId === actorId);
      if (!visible) return null;

      const relationReference = transaction.collection(collection).doc(relationId);
      const relationResult = await relationReference.get();
      throwResolvedCloudBaseError(relationResult);
      const existing = cleanDocument(firstDocument(relationResult.data));
      if (existing) return existing;
      const interactionVersion = momentInteractionVersion(moment.interactionVersion);
      const updateResult = await momentReference.update({ interactionVersion: interactionVersion + 1 });
      throwResolvedCloudBaseError(updateResult);
      const setResult = await relationReference.set(data);
      throwResolvedCloudBaseError(setResult);
      return structuredClone(data);
    });
  }

  async markMomentDeleting(momentId: string): Promise<void> {
    await this.db.runTransaction(async (transaction: CloudTransaction) => {
      const reference = transaction.collection("moments").doc(momentId);
      const result = await reference.get();
      throwResolvedCloudBaseError(result);
      const existing = cleanDocument(firstDocument(result.data));
      if (!existing) return;
      const updateResult = await reference.update({ deleting: true });
      throwResolvedCloudBaseError(updateResult);
    });
  }

  async countDocuments(collection: string): Promise<number> {
    const result = await this.db.collection(collection).count();
    throwResolvedCloudBaseError(result);
    return result.total;
  }

  async scanDocuments(collection: string, afterId: string | null, limit: number): Promise<StoredDocument[]> {
    let query: CloudQuery = this.db.collection(collection);
    if (afterId !== null) query = query.where({ _id: this.db.command.gt(afterId) });
    const result = await query.orderBy("_id", "asc").limit(limit).get();
    throwResolvedCloudBaseError(result);
    return result.data.flatMap((value) => {
      if (typeof value !== "object" || value === null || typeof value._id !== "string") return [];
      const data = cleanDocument(value);
      return data ? [{ id: value._id, data }] : [];
    });
  }

  async upload(key: string, bytes: Uint8Array): Promise<string> {
    const result = await this.app.uploadFile({ cloudPath: key, fileContent: Buffer.from(bytes) });
    throwResolvedCloudBaseError(result);
    return result.fileID;
  }

  async downloadFile(fileId: string): Promise<Uint8Array> {
    const result = await this.app.downloadFile({ fileID: fileId });
    throwResolvedCloudBaseError(result);
    const content = result.fileContent;
    if (Buffer.isBuffer(content)) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
    if (typeof content === "string") return new TextEncoder().encode(content);
    throw new Error("downloaded file content unavailable");
  }

  async temporaryUrl(storedKey: string): Promise<string> {
    let fileID = storedKey;
    if (!storedKey.startsWith("cloud://")) {
      const metadata = await this.app.getUploadMetadata({ cloudPath: storedKey });
      throwResolvedCloudBaseError(metadata);
      fileID = metadata.data?.fileId;
      if (!fileID) throw new Error("storage file ID unavailable");
    }
    const result = await this.app.getTempFileURL({ fileList: [{ fileID, maxAge: 24 * 60 * 60 }] });
    throwResolvedCloudBaseError(result);
    const url = result.fileList[0]?.tempFileURL;
    if (!url) throw new Error("avatar URL unavailable");
    return url;
  }

  async uploadMetadata(cloudPath: string): Promise<UploadMetadata> {
    const result = await this.app.getUploadMetadata({ cloudPath });
    throwResolvedCloudBaseError(result);
    const { url, authorization, token, cosFileId, fileId } = result.data ?? {};
    if (!url || !authorization || !token || !cosFileId || !fileId) throw new Error("upload metadata incomplete");
    return { uploadUrl: url, authorization, token, cosFileId, fileId };
  }

  async temporaryFileUrl(fileId: string): Promise<string> {
    // 兼容完整 cloud:// fileId 与裸 cloudPath：先从 fileId 提取 cloudPath，
    // 再经 getUploadMetadata 取合法 fileID（与头像一致的可靠解析路径）。
    const cloudPath = fileId.startsWith("cloud://")
      ? fileId.replace(/^cloud:\/\/[^/]+\//, "")
      : fileId;
    const metadata = await this.app.getUploadMetadata({ cloudPath });
    throwResolvedCloudBaseError(metadata);
    const resolvedFileId = metadata.data?.fileId;
    if (!resolvedFileId) throw new Error("image file ID unavailable");
    const result = await this.app.getTempFileURL({ fileList: [{ fileID: resolvedFileId, maxAge: 24 * 60 * 60 }] });
    throwResolvedCloudBaseError(result);
    const url = result.fileList[0]?.tempFileURL;
    if (!url) throw new Error("image URL unavailable");
    return url;
  }
}

function numberValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("invalid number field");
  return value;
}
function momentInteractionVersion(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error("invalid moment interaction version");
  }
  return value;
}
