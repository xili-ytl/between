import { AppError } from "../domain/errors.js";
import type { ReleaseArtifactStore } from "../ports/stores.js";

export interface ReleaseManifest {
  versionCode: number;
  versionName: string;
  notes: string;
  apkKey: string;
  sha256: string;
}

export interface PublicRelease extends Omit<ReleaseManifest, "apkKey"> {
  downloadUrl: string;
}

/** 桌面端 Q 宠安装包版本清单（NSIS Setup.exe）。 */
export interface PetReleaseManifest {
  version: string;
  versionCode: number;
  notes: string[];
  artifactKey: string; // releases/pet/*.exe
  size: number;
  sha256: string;
  signature: string;
}

export interface PublicPetRelease extends PetReleaseManifest {
  /** Backward-compatible alias used by the installed 0.1.x desktop updater. */
  versionName: string;
  downloadUrl: string;
}

export class ReleaseService {
  constructor(
    private readonly manifest: ReleaseManifest,
    private readonly artifacts: ReleaseArtifactStore,
    private readonly petManifest?: PetReleaseManifest
  ) {}

  async latest(): Promise<PublicRelease> {
    validate(this.manifest);
    const downloadUrl = await this.artifacts.temporaryUrl(this.manifest.apkKey);
    if (!downloadUrl.startsWith("https://")) {
      throw new AppError("RELEASE_INVALID", "更新配置无效");
    }
    return {
      versionCode: this.manifest.versionCode,
      versionName: this.manifest.versionName,
      notes: this.manifest.notes,
      downloadUrl,
      sha256: this.manifest.sha256
    };
  }

  /** 桌面端 Q 宠的最新安装包（应用内自动更新用）。 */
  async petLatest(): Promise<PublicPetRelease> {
    if (!this.petManifest) throw new AppError("RELEASE_UNAVAILABLE", "暂时无法检查更新");
    validatePet(this.petManifest);
    const downloadUrl = await this.artifacts.temporaryUrl(this.petManifest.artifactKey);
    if (!downloadUrl.startsWith("https://")) {
      throw new AppError("RELEASE_INVALID", "更新配置无效");
    }
    return {
      version: this.petManifest.version,
      versionName: this.petManifest.version,
      versionCode: this.petManifest.versionCode,
      notes: [...this.petManifest.notes],
      artifactKey: this.petManifest.artifactKey,
      size: this.petManifest.size,
      downloadUrl,
      sha256: this.petManifest.sha256,
      signature: this.petManifest.signature
    };
  }
}

function validate(manifest: ReleaseManifest): void {
  if (!Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1 ||
    manifest.versionName.trim().length < 1 || manifest.versionName.length > 32 ||
    manifest.notes.length > 500 || !/^releases\/[A-Za-z0-9._-]+\.apk$/.test(manifest.apkKey) ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new AppError("RELEASE_INVALID", "更新配置无效");
  }
}

function validatePet(manifest: PetReleaseManifest): void {
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) ||
    !Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1 ||
    !Array.isArray(manifest.notes) || manifest.notes.length > 20 ||
    manifest.notes.some((note) => typeof note !== "string" || note.length > 300) ||
    !/^releases\/pet\/[A-Za-z0-9._-]+\.exe$/.test(manifest.artifactKey) ||
    !Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > 512 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    !/^[A-Za-z0-9+/]{86}==$/.test(manifest.signature)) {
    throw new AppError("RELEASE_INVALID", "更新配置无效");
  }
}
