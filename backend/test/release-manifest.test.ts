import { describe, expect, it } from "vitest";
import { CURRENT_RELEASE } from "../src/release-manifest.js";

describe("current release manifest", () => {
  it("publishes the verified original-signed Android release", () => {
    expect(CURRENT_RELEASE).toMatchObject({
      versionCode: 70,
      versionName: "1.1.37",
      apkKey: "releases/between-70.apk",
      sha256: "79c1183a3c17269a1cb34b26cdd2d761ddb7037fc7a6f3e3ca35ffc4a87b2144"
    });
    expect(CURRENT_RELEASE.notes).toBe("修复问理回复中多个代码块的显示错位。");
    expect(CURRENT_RELEASE).not.toMatchObject({
      versionCode: 69,
      versionName: "1.1.36",
      apkKey: "releases/between-69.apk"
    });
  });

  it("keeps the apk key and the announced version code in step", () => {
    // 发版时漏改这里的断言，测试就会和线上清单说的不是同一个版本。
    expect(CURRENT_RELEASE.apkKey).toBe(`releases/between-${CURRENT_RELEASE.versionCode}.apk`);
  });
});
