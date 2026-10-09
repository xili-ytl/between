export interface WenliImageProvider {
  imageBytes(imageFileId: string): Promise<Uint8Array | null>;
}
