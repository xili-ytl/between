import { describe, expect, it } from "vitest";
import {
  ReleaseService,
  type PetReleaseManifest,
  type ReleaseManifest
} from "../src/services/release-service.js";

const valid: ReleaseManifest = {
  versionCode: 6,
  versionName: "1.0",
  notes: "优化聊天输入和头像同步",
  apkKey: "releases/between-6.apk",
  sha256: "a".repeat(64)
};

const validPet: PetReleaseManifest = {
  version: "1.0.1",
  versionCode: 101,
  notes: ["基于成熟 Q 宠项目重构，并接入问理 AI"],
  artifactKey: "releases/pet/between-qpet-1.0.1.exe",
  size: 123,
  sha256: "b".repeat(64),
  signature: Buffer.alloc(64, 1).toString("base64")
};

describe("ReleaseService", () => {
  it("turns the private storage key into a temporary download URL", async () => {
    const service = new ReleaseService(valid, {
      temporaryUrl: async (key) => `https://download.test/${key}?signed=1`
    });

    await expect(service.latest()).resolves.toEqual({
      versionCode: 6,
      versionName: "1.0",
      notes: "优化聊天输入和头像同步",
      downloadUrl: "https://download.test/releases/between-6.apk?signed=1",
      sha256: "a".repeat(64)
    });
  });

  it.each([
    { ...valid, versionCode: 0 },
    { ...valid, versionName: "" },
    { ...valid, apkKey: "avatars/1001/a.jpg" },
    { ...valid, sha256: "not-a-sha" }
  ])("rejects an unsafe manifest", async (manifest) => {
    const service = new ReleaseService(manifest, { temporaryUrl: async () => "https://download.test/app.apk" });
    await expect(service.latest()).rejects.toMatchObject({ code: "RELEASE_INVALID" });
  });
});

describe("ReleaseService.petLatest", () => {
  it("returns every signed field plus a fresh temporary URL", async () => {
    const service = new ReleaseService(valid, {
      temporaryUrl: async (key) => `https://download.test/${key}?signed=1`
    }, validPet);

    await expect(service.petLatest()).resolves.toEqual({
      ...validPet,
      versionName: validPet.version,
      downloadUrl: "https://download.test/releases/pet/between-qpet-1.0.1.exe?signed=1"
    });
  });

  it.each([
    { ...validPet, version: "1.0" },
    { ...validPet, versionCode: 0 },
    { ...validPet, artifactKey: "releases/between.apk" },
    { ...validPet, size: 0 },
    { ...validPet, sha256: "not-a-sha" },
    { ...validPet, signature: "not-base64" }
  ])("rejects an unsigned or unsafe pet manifest", async (manifest) => {
    const service = new ReleaseService(valid, {
      temporaryUrl: async () => "https://download.test/qpet.exe"
    }, manifest);
    await expect(service.petLatest()).rejects.toMatchObject({ code: "RELEASE_INVALID" });
  });
});
