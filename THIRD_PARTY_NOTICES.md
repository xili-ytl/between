# Third-party notices

The project's [MIT License](LICENSE) covers original project code, documentation, and synthetic examples. It does not relicense the third-party resources or dependencies described below. Their own notices, license texts, exceptions, and applicable service terms continue to apply. This repository is a source preview; distribution of an APK or function package requires checking the artifacts actually included in that distribution.

## Phosphor Icons

- Package: `@phosphor-icons/core`
- Version: `2.1.1`
- Source assets and normalized source-content SHA-256 values:
  - `assets/regular/chats-circle.svg`: `672fea51548c727b020bf6532d2e350fb0189c8fe36725f2127530f11868a8ec`
  - `assets/regular/users.svg`: `b3385e4c6aa03f7e16d1b03887c2cdff9900f5a7edbd5ea5176055938ccfb908`
  - `assets/regular/compass.svg`: `00c7e42415f795fcea90bd9dc0b2c8266b4e9601d2937cb122cd03b7e9e9e198`
  - `assets/regular/user.svg`: `787434f7fef95f20e137d309d3c6b8b471548c55c9dfc137ae10625d70959d11`
  - `assets/regular/user-gear.svg`: `4091ced4f8297dbcd12a2b1993b0081667f6cdf9dbb31d1606543bd66ddb9bcc`
  - `assets/regular/gear-six.svg`: `2bb05ec80cc37505a3f21c74989dbb297ab8442a668f5ffbd6a8f7c1d5794c7b`
  - `assets/regular/heart.svg`: `312dee73d1d969631d5498012f619ccf4edbdf31e1be3e65af4f4f1b3ac1b2dd`
- Local sources: `third_party/phosphor-icons/*.svg`
- npm tarball integrity: `sha512-v4ARvrip4qBCImOE5rmPUylOEK4iiED9ZyKjcvzuezqMaiRASCHKcRIuvvxL/twvLpkfnEODCOJp5dM4eZilxQ==`
- License: MIT; the complete text is preserved at `third_party/phosphor-icons/LICENSE`.

The launcher and in-app navigation artwork are derived from the official SVG paths. The screenshot used to choose the launcher icon is not included in or used to generate the application assets.

## Tencent WeUI

- Project: `Tencent/weui`
- Source commit: `7a6f8ad7700d0d6f1361dbe5e2942b4b129e7a7e`
- Source file: `src/style/icon/weui-icon.less`
- Source glyphs: `arrow` and `back-arrow`
- Derived Android resources: `weui_ic_disclosure_arrow.xml` and `weui_ic_back_arrow.xml`
- License: MIT License; the complete applicable text and Tencent copyright notice are preserved at `third_party/weui/LICENSE`.

Only the two SVG path definitions above are derived from WeUI source. No WeChat logo, screenshot, demo raster image, or WeUI build dependency is included.

## AppUpdater

- Project: `jenly1314/AppUpdater`
- Version: `2.2.0`
- Source: `https://github.com/jenly1314/AppUpdater`
- Included module: `app-updater`
- License: MIT; the complete text is preserved at `third_party/appupdater/LICENSE`.

The application uses AppUpdater only as the APK download engine. Automatic installation is disabled; the app verifies the downloaded APK before opening Android's system installer.

## JPush (optional push delivery)

- Android artifact: `cn.jiguang.sdk:jpush:6.2.0`.
- The resolved artifact POM declares Apache License 2.0. The project's own license does not replace the SDK's license or the [Jiguang developer and service agreements](https://www.jiguang.cn/license).
- The SDK transitively depends on JCore. Its published dependency uses a version range, so a fresh build may resolve a different JCore version from an existing local cache; no reproducible JCore lock is claimed.
- Push delivery is optional and requires a deployment owner's Jiguang configuration. Credentials, registration data, and production configuration are not included in this repository.

Before distributing an application binary, review the exact resolved SDK artifacts, included notices, and the service's privacy requirements. This source preview does not redistribute a signed APK.

## Dots Two Horizontal

- Source: SVG Repo, `https://www.svgrepo.com/svg/353086/dots-two-horizontal`
- Local source: `third_party/svg-repo/dots-two-horizontal.svg`
- Derived Android resource: `ic_dots_two_horizontal.xml`
- License: CC0.

The Android vector preserves the original 20×20 two-dot geometry; only the fill color is adapted to the app's interface palette.

## Chat Markdown and LaTeX rendering

- Markwon project: `noties/Markwon`, version `4.6.2`, source `https://github.com/noties/Markwon`.
- Included Android artifacts and resolved artifact sizes:
  - `io.noties.markwon:core:4.6.2` — 133,475 bytes (`core-4.6.2.aar`)
  - `io.noties.markwon:inline-parser:4.6.2` — 38,196 bytes (`inline-parser-4.6.2.aar`)
  - `io.noties.markwon:ext-latex:4.6.2` — 39,125 bytes (`ext-latex-4.6.2.aar`)
  - `io.noties.markwon:ext-strikethrough:4.6.2` — 14,316 bytes (`ext-strikethrough-4.6.2.aar`)
  - `io.noties.markwon:ext-tables:4.6.2` — 41,742 bytes (`ext-tables-4.6.2.aar`)
  - `io.noties.markwon:ext-tasklist:4.6.2` — 22,997 bytes (`ext-tasklist-4.6.2.aar`)
- Markwon license: Apache License 2.0; the applicable text is available from the project's license file and the Maven metadata.

Markwon is used through native Android `TextView` spans/drawables. The chat renderer does not register the HTML plugin or an image loader, and it only resolves `http`/`https` links on explicit user activation.

### Markwon LaTeX renderer and fonts

- `ru.noties:jlatexmath-android:0.2.0` — 650,835 bytes (`jlatexmath-android-0.2.0.aar`), source `https://github.com/noties/jlatexmath-android`.
- License: GPLv2 with the JLatexMath independent-module linking exception. The artifact POM declares GPLv2; the Android fork preserves the exception in its [LICENSE](https://github.com/noties/jlatexmath-android/blob/android/LICENSE). The dependency remains under its own license rather than the application's license.
- The resolved 0.2.0 AAR contains font notices under `assets/org/scilab/forge/jlatexmath/fonts/licences/`: `Knuth_License.txt`, `License_for_dsrom.txt`, and `OFL.txt`. This describes the inspected artifact, not every optional font module in upstream JLatexMath.

### Transitive CommonMark parser

- `com.atlassian.commonmark:commonmark:0.13.0` — 141,562 bytes (`commonmark-0.13.0.jar`)
- `com.atlassian.commonmark:commonmark-ext-gfm-strikethrough:0.13.0` — 10,377 bytes (`commonmark-ext-gfm-strikethrough-0.13.0.jar`)
- `com.atlassian.commonmark:commonmark-ext-gfm-tables:0.13.0` — 19,314 bytes (`commonmark-ext-gfm-tables-0.13.0.jar`)
- Project: `https://github.com/atlassian/commonmark-java`
- License: BSD 2-Clause License; the applicable text is declared by `commonmark-parent:0.13.0` and is available at `https://opensource.org/licenses/BSD-2-Clause`.
