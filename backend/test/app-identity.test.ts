import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function projectPath(relativePath: string): string {
  return resolve(repositoryRoot, relativePath);
}

function readProjectFile(relativePath: string): string {
  const path = projectPath(relativePath);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function schemeBlock(theme: string, name: string): string {
  return theme.match(new RegExp(`${name} = (?:light|dark)ColorScheme\\(([^]*?)\\n\\)`))?.[1] ?? "";
}

function schemeColor(block: string, role: string): string {
  return block.match(new RegExp(`^\\s*${role} = Color\\(0xFF([0-9A-F]{6})\\),$`, "m"))?.[1] ?? "";
}

function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string): number => {
    const linearChannel = (offset: number): number => {
      const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linearChannel(0) + 0.7152 * linearChannel(2) + 0.0722 * linearChannel(4);
  };
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function componentCalls(source: string, componentName: string): string[] {
  const calls: string[] = [];
  const needle = `${componentName}(`;
  let searchFrom = 0;
  while (true) {
    const start = source.indexOf(needle, searchFrom);
    if (start < 0) return calls;
    let depth = 0;
    let end = start + needle.length;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (character === "(") depth += 1;
      if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
    }
    calls.push(source.slice(start, end + 1));
    searchFrom = end + 1;
  }
}

describe("Between Android app identity", () => {
  it("keeps primary screens free of unsolicited guidance", () => {
    const login = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/feature/login/LoginScreen.kt",
    );
    const chat = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/feature/chat/ChatScreen.kt",
    );
    const settings = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/feature/settings/SettingsScreen.kt",
    );
    const about = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/feature/settings/AboutScreen.kt",
    );

    expect(login).toContain('label = { Text("账号") }');
    expect(login).toContain('label = { Text("密码") }');
    expect(login).not.toContain("1001 或 1002");
    expect(login).not.toContain("只属于你们两个人");
    expect(chat).not.toContain("还没有消息，说句话吧");
    expect(chat).not.toContain("正在同步");
    expect(settings).not.toContain("数据由云端永久保存");
    // 关于页改版后这句话不加句号（旧契约是「…永久保存。」）
    expect(about.match(/数据由云端永久保存/g)).toHaveLength(1);
    expect(about).not.toContain("数据由云端永久保存。");
    expect(settings).not.toContain("你们的聊天记录");
    expect(settings).not.toContain("不提供删除");
    expect(settings).not.toContain("撤回");
    expect(settings).not.toContain("拉黑");
    expect(settings).not.toContain('Text("账号 $accountId"');
    // 关于页改版：数据说明改为更小的次要文字，仍然使用次要前景色
    expect(about).toContain("style = MaterialTheme.typography.bodySmall");
    expect(about).toContain("color = MaterialTheme.colorScheme.onSurfaceVariant");
  });

  it("uses the fixed restrained Between color theme without dynamic colors", () => {
    const theme = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/ui/BetweenTheme.kt",
    );
    const activity = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/MainActivity.kt",
    );

    expect(theme).toContain("Color(0xFF07C160)");
    expect(theme).toContain("Color(0xFFF5F5F5)");
    expect(theme).toContain("Color(0xFFFFFFFF)");
    expect(theme).toContain("Color(0xFF191919)");
    expect(theme).toContain("Color(0xFFE5E5E5)");
    expect(theme).toContain("darkColorScheme(");
    expect(theme).not.toContain("dynamicLightColorScheme");
    expect(theme).not.toContain("dynamicDarkColorScheme");
    expect(activity).toContain("BetweenTheme {");
    expect(activity).not.toContain("lightColorScheme()");
    expect(activity).not.toContain("darkColorScheme()");
  });

  it("defines accessible green and neutral color roles without Material purple defaults", () => {
    const theme = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/ui/BetweenTheme.kt",
    );
    const settings = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/feature/settings/SettingsScreen.kt",
    );
    const profile = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/feature/me/ProfileEditScreen.kt",
    );
    const light = schemeBlock(theme, "BetweenLightColors");
    const dark = schemeBlock(theme, "BetweenDarkColors");
    const requiredRoles = [
      "primary", "onPrimary", "primaryContainer", "onPrimaryContainer", "inversePrimary",
      "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
      "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
      "background", "onBackground", "surface", "onSurface", "surfaceVariant", "onSurfaceVariant",
      "surfaceTint", "inverseSurface", "inverseOnSurface", "error", "onError",
      "errorContainer", "onErrorContainer", "outline", "outlineVariant", "scrim",
      "surfaceBright", "surfaceContainer", "surfaceContainerHigh", "surfaceContainerHighest",
      "surfaceContainerLow", "surfaceContainerLowest", "surfaceDim",
    ];
    const contrastPairs: ReadonlyArray<readonly [string, string]> = [
      ["primary", "onPrimary"],
      ["primaryContainer", "onPrimaryContainer"],
      ["secondary", "onSecondary"],
      ["secondaryContainer", "onSecondaryContainer"],
      ["tertiary", "onTertiary"],
      ["tertiaryContainer", "onTertiaryContainer"],
      ["background", "onBackground"],
      ["surface", "onSurface"],
      ["surface", "secondary"],
      ["background", "secondary"],
      ["surfaceVariant", "onSurfaceVariant"],
      ["inverseSurface", "inverseOnSurface"],
      ["inverseSurface", "inversePrimary"],
      ["surfaceBright", "onSurface"],
      ["surfaceContainer", "onSurface"],
      ["surfaceContainerHigh", "onSurface"],
      ["surfaceContainerHighest", "onSurface"],
      ["surfaceContainerLow", "onSurface"],
      ["surfaceContainerLowest", "onSurface"],
      ["surfaceDim", "onSurface"],
      ["error", "onError"],
      ["errorContainer", "onErrorContainer"],
    ];

    for (const [name, block] of [["light", light], ["dark", dark]] as const) {
      for (const role of requiredRoles) {
        expect(schemeColor(block, role), `${name}.${role}`).toMatch(/^[0-9A-F]{6}$/);
      }
      for (const [backgroundRole, foregroundRole] of contrastPairs) {
        expect(
          contrastRatio(schemeColor(block, backgroundRole), schemeColor(block, foregroundRole)),
          `${name}.${foregroundRole} on ${backgroundRole}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    expect(schemeColor(light, "primary")).toBe("07C160");
    expect(schemeColor(light, "onPrimary")).toBe("191919");
    expect(settings, "settings generic success message").not.toContain("state.message?.let");
    expect(profile, "profile generic success message").not.toContain("state.message?.let");
    expect(profile, "profile error feedback").toContain("state.error?.let");
  });

  it("uses the accessible secondary green for the selected home tab", () => {
    const theme = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/ui/BetweenTheme.kt",
    );
    const home = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/feature/home/HomeScreen.kt",
    );
    const light = schemeBlock(theme, "BetweenLightColors");

    expect(schemeColor(light, "secondary")).toBe("0B6B3A");
    expect(
      contrastRatio(schemeColor(light, "secondary"), schemeColor(light, "surface")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(home).toContain("selectedIconColor = MaterialTheme.colorScheme.secondary");
    expect(home).toContain("selectedTextColor = MaterialTheme.colorScheme.secondary");
    expect(home).not.toContain("selectedIconColor = MaterialTheme.colorScheme.primary");
    expect(home).not.toContain("selectedTextColor = MaterialTheme.colorScheme.primary");
    expect(home).toContain("indicatorColor = Color.Transparent");
  });

  it("applies accessible action and focused-field colors at every scoped component call site", () => {
    const theme = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/ui/BetweenTheme.kt",
    );
    const screenPaths = [
      "android/app/src/main/java/com/privatechat/couplechat/AppNavHost.kt",
      "android/app/src/main/java/com/privatechat/couplechat/feature/login/LoginScreen.kt",
      "android/app/src/main/java/com/privatechat/couplechat/feature/chat/ChatScreen.kt",
      "android/app/src/main/java/com/privatechat/couplechat/feature/contacts/ContactDetailScreen.kt",
      "android/app/src/main/java/com/privatechat/couplechat/feature/contacts/ContactsScreen.kt",
      "android/app/src/main/java/com/privatechat/couplechat/feature/home/HomeScreen.kt",
      "android/app/src/main/java/com/privatechat/couplechat/feature/home/MessagesTab.kt",
      "android/app/src/main/java/com/privatechat/couplechat/feature/me/MeScreen.kt",
      "android/app/src/main/java/com/privatechat/couplechat/feature/me/ProfileEditScreen.kt",
      "android/app/src/main/java/com/privatechat/couplechat/feature/settings/SettingsScreen.kt",
    ];
    const screens = screenPaths.map((path) => ({ path, source: readProjectFile(path) }));
    const light = schemeBlock(theme, "BetweenLightColors");

    expect(schemeColor(light, "secondary")).toBe("0B6B3A");
    expect(theme).toContain("fun betweenTextButtonColors(): ButtonColors");
    expect(theme).toContain("contentColor = MaterialTheme.colorScheme.secondary");
    expect(theme).toContain("fun betweenOutlinedTextFieldColors(): TextFieldColors");
    expect(theme).toContain("focusedTextColor = MaterialTheme.colorScheme.onSurface");
    expect(theme).toContain("focusedBorderColor = MaterialTheme.colorScheme.secondary");
    expect(theme).toContain("focusedLabelColor = MaterialTheme.colorScheme.secondary");
    expect(theme).toContain("cursorColor = MaterialTheme.colorScheme.secondary");
    expect(theme).toContain("errorBorderColor = MaterialTheme.colorScheme.error");
    expect(theme).toContain("errorLabelColor = MaterialTheme.colorScheme.error");
    expect(theme).toContain("errorCursorColor = MaterialTheme.colorScheme.error");
    expect(theme).not.toContain("ButtonDefaults.buttonColors(");

    const textButtonCalls = screens.flatMap(({ path, source }) =>
      componentCalls(source, "TextButton").map((call) => ({ path, call })),
    );
    expect(textButtonCalls.length).toBeGreaterThan(0);
    for (const { path, call } of textButtonCalls) {
      expect(call, `${path} TextButton policy`).toContain("colors = betweenTextButtonColors()");
    }

    const outlinedFieldCalls = screens.flatMap(({ path, source }) =>
      componentCalls(source, "OutlinedTextField").map((call) => ({ path, call })),
    );
    expect(outlinedFieldCalls.length).toBeGreaterThan(0);
    for (const { path, call } of outlinedFieldCalls) {
      expect(call, `${path} OutlinedTextField policy`).toContain(
        "colors = betweenOutlinedTextFieldColors()",
      );
    }
  });

  it("uses 之间 for every primary user-facing app name", () => {
    const strings = readProjectFile("android/app/src/main/res/values/strings.xml");
    const loginScreen = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/feature/login/LoginScreen.kt",
    );
    const brandIdentity = readProjectFile(
      "android/app/src/main/java/com/privatechat/couplechat/ui/BrandIdentity.kt",
    );
    const readme = readProjectFile("README.md");

    expect(strings).toContain('<string name="app_name">之间</string>');
    expect(loginScreen).toContain("BetweenBrand(");
    expect(brandIdentity).toContain("世界之外，\\n你我之间。");
    expect(brandIdentity).toContain("Beyond the World, Between You and Me.");
    // README 的职责已由「应用说明」变为「当前开发工作区导航」，标题可带副标题；
    // 这里只要求产品名仍是标题开头，不再要求标题只有一个词。
    expect(readme.replaceAll("\r\n", "\n").startsWith("# 之间")).toBe(true);
  });

  it("preserves the installed application identity while using launcher mipmaps", () => {
    const manifest = readProjectFile("android/app/src/main/AndroidManifest.xml");
    const buildScript = readProjectFile("android/app/build.gradle.kts");

    expect(buildScript).toContain('applicationId = "com.privatechat.couplechat"');
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher_round"');
  });

  it("preserves the authentic Phosphor chats-circle source and license", () => {
    const svgPath = projectPath("third_party/phosphor-icons/chats-circle.svg");
    const svg = readProjectFile("third_party/phosphor-icons/chats-circle.svg");
    const normalizedSvg = svg.replace(/\r?\n$/, "");
    const license = readProjectFile("third_party/phosphor-icons/LICENSE");
    const notices = readProjectFile("THIRD_PARTY_NOTICES.md");

    expect(existsSync(svgPath)).toBe(true);
    expect(createHash("sha256").update(normalizedSvg).digest("hex")).toBe(
      "672fea51548c727b020bf6532d2e350fb0189c8fe36725f2127530f11868a8ec",
    );
    expect(svg).toContain('viewBox="0 0 256 256"');
    expect(svg).toContain('<path d="M232.07,186.76');
    expect(license).toContain("MIT License");
    expect(license).toContain("Copyright (c) 2023 Phosphor Icons");
    expect(notices).toContain("@phosphor-icons/core");
    expect(notices).toContain("2.1.1");
    expect(notices).toContain("assets/regular/chats-circle.svg");
  });

  it("derives a warm adaptive icon from the official path without dead resources", () => {
    const colors = readProjectFile("android/app/src/main/res/values/colors.xml");
    const foreground = readProjectFile(
      "android/app/src/main/res/drawable/ic_launcher_foreground.xml",
    );
    const obsoleteFallback = projectPath(
      "android/app/src/main/res/drawable/ic_launcher.xml",
    );
    const adaptive = readProjectFile(
      "android/app/src/main/res/mipmap-anydpi/ic_launcher.xml",
    );
    const adaptiveRound = readProjectFile(
      "android/app/src/main/res/mipmap-anydpi/ic_launcher_round.xml",
    );
    const obsoleteVersionedIcon = projectPath(
      "android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
    );
    const svgPathData = readProjectFile("third_party/phosphor-icons/chats-circle.svg").match(
      /<path d="([^"]+)"/,
    )?.[1];
    const androidPathData = foreground.match(/android:pathData="([^"]+)"/)?.[1];

    expect(colors).toContain('<color name="launcher_background">#F5F2EC</color>');
    expect(colors).toContain('<color name="launcher_foreground">#171717</color>');
    expect(foreground).toContain('android:scaleX="0.62"');
    expect(foreground).toContain('android:scaleY="0.62"');
    expect(foreground).toContain('android:fillColor="@color/launcher_foreground"');
    expect(foreground).toContain('android:pathData="M232.07,186.76');
    expect(androidPathData).toBe(svgPathData);
    expect(adaptive).toContain('android:drawable="@color/launcher_background"');
    expect(adaptive).toContain('android:drawable="@drawable/ic_launcher_foreground"');
    expect(adaptive).toContain(
      '<monochrome android:drawable="@drawable/ic_launcher_foreground" />',
    );
    expect(adaptiveRound).toBe(adaptive);
    expect(existsSync(obsoleteVersionedIcon)).toBe(false);
    expect(existsSync(obsoleteFallback)).toBe(false);
  });
});
