import type { CloudPersistence } from "../src/adapters/cloudbase-stores.js";
import { CloudBaseImageBytesProvider } from "../src/adapters/cloudbase-image-bytes.js";
import { describe, expect, it, vi } from "vitest";

describe("CloudBaseImageBytesProvider", () => {
  it("returns private image bytes from persistence", async () => {
    const downloadFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const provider = new CloudBaseImageBytesProvider({ downloadFile } as unknown as CloudPersistence);

    await expect(provider.imageBytes("cloud://private/image.jpg")).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(downloadFile).toHaveBeenCalledExactlyOnceWith("cloud://private/image.jpg");
  });

  it("returns null when private image download fails", async () => {
    const downloadFile = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    const provider = new CloudBaseImageBytesProvider({ downloadFile } as unknown as CloudPersistence);

    await expect(provider.imageBytes("cloud://private/missing.jpg")).resolves.toBeNull();
  });
});
