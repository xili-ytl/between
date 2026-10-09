import type { CloudPersistence } from "./cloudbase-stores.js";
import type { WenliImageProvider } from "../ports/wenli-image-provider.js";

export class CloudBaseImageBytesProvider implements WenliImageProvider {
  constructor(private readonly cloud: CloudPersistence) {}

  async imageBytes(imageFileId: string): Promise<Uint8Array | null> {
    try {
      return await this.cloud.downloadFile(imageFileId);
    } catch {
      return null;
    }
  }
}
