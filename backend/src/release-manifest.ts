import type { PetReleaseManifest, ReleaseManifest } from "./services/release-service.js";

// Public Android release: this must match the independently verified
// original-signed APK uploaded to the same release object.
export const CURRENT_RELEASE: ReleaseManifest = {
  versionCode: 70,
  versionName: "1.1.37",
  notes: "修复问理回复中多个代码块的显示错位。",
  apkKey: "releases/between-70.apk",
  sha256: "79c1183a3c17269a1cb34b26cdd2d761ddb7037fc7a6f3e3ca35ffc4a87b2144"
};

// 桌面端 Q 宠安装包版本（应用内自动更新；sha256 在发布前用 Setup.exe 真实哈希替换）。
export const CURRENT_PET_RELEASE: PetReleaseManifest = {
  version: "1.0.8",
  versionCode: 22,
  notes: ["每次启动显示登录界面，设置可退出登录/切换；下载完成自动安装；自动清理旧版本缓存。"],
  artifactKey: "releases/pet/between-qpet-1.0.8.exe",
  size: 284432250,
  sha256: "7adab51947de27b6761e93f4ad7eba021080343b36c4337dee9894a5c45a05b1",
  signature: "fqtFduhPfHu77qPZiHmurR4eL/kBDUFgDLD5oXH7kEt6XLYA9c6zRNotHY3X4EGM149KWWgot1qlOvW2gq25DA=="
};
