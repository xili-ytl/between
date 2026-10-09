import { beforeEach, describe, expect, it } from "vitest";
import { MemoryImageStorage } from "../src/adapters/memory-stores.js";
import { ImageService } from "../src/services/image-service.js";

describe("ImageService", () => {
  let storage: MemoryImageStorage;
  let now: number;
  let service: ImageService;

  beforeEach(() => {
    storage = new MemoryImageStorage();
    now = 1_000_000;
    service = new ImageService(storage, () => now);
  });

  it("issues an upload credential tied to the owner and message id", async () => {
    const credential = await service.uploadCredential("1001", "img-1", "image/jpeg");
    expect(credential).toMatchObject({
      authorization: "memory-authorization",
      fileId: "cloud://memory-bucket/chat-images/1001_img-1.jpg"
    });
    expect(credential.uploadUrl).toContain("chat-images/1001_img-1.jpg");
  });

  it("rejects bad message ids and unsupported mime types", async () => {
    await expect(service.uploadCredential("1001", "bad/id", "image/jpeg"))
      .rejects.toMatchObject({ code: "MESSAGE_ID_INVALID" });
    await expect(service.uploadCredential("1001", "img-2", "image/gif"))
      .rejects.toMatchObject({ code: "IMAGE_INVALID" });
  });

  it("returns a temporary url for a stored chat image", async () => {
    const url = await service.imageUrl("cloud://env-bucket/chat-images/1001_img-1.jpg");
    expect(url).toContain("chat-images/1001_img-1.jpg");
  });

  it("rejects non-chat image file ids", async () => {
    await expect(service.imageUrl("cloud://env-bucket/avatars/1001.jpg"))
      .rejects.toMatchObject({ code: "IMAGE_INVALID" });
    await expect(service.imageUrl("not-a-cloud-file"))
      .rejects.toMatchObject({ code: "IMAGE_INVALID" });
  });

  it("rate limits upload credential requests per account", async () => {
    for (let index = 0; index < 20; index += 1) {
      await service.uploadCredential("1001", `img-${index}`, "image/jpeg");
    }
    await expect(service.uploadCredential("1001", "img-last", "image/jpeg"))
      .rejects.toMatchObject({ code: "IMAGE_RATE_LIMITED" });
    await expect(service.uploadCredential("1002", "img-ok", "image/jpeg")).resolves.toBeDefined();
  });
});
