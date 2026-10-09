import { describe, expect, it } from "vitest";
import { cleanWenliReply, hasWenliEmoji } from "../src/domain/wenli-reply-text.js";

describe("Wenli visible reply text", () => {
  it.each([
    "(Ｔ▽Ｔ)", ">_<", "X_X", "QwQ", "qwq", "(＾▽＾)", "^ ^",
    "普通汉字，问理在这里。", "± × ∞ ∑ √ ∆ ≠ ≤ ≥ ↔", "© 2026 ® ™", "©︎ ®︎ ™︎",
    "1 234567890 # *", "https://example.com/a?q=1#part", "e\u0301 中文\uFE00"
  ])("preserves ordinary text: %s", text => {
    expect(cleanWenliReply(`  ${text}\n`)).toBe(text);
    expect(hasWenliEmoji(text)).toBe(false);
  });

  it.each([
    "😀", "🐧", "👍🏽", "👨‍👩‍👧‍👦", "👩🏾‍💻", "🏳️‍🌈", "🇨🇳", "🇺🇳",
    "1️⃣", "#️⃣", "*️⃣", "2\u20E3", "©️", "®️", "™️", "♥", "☀", "❤", "☀︎",
    "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
    "🏽", "🏽️", "🇨"
  ])("removes the whole emoji sequence: %s", emoji => {
    expect(hasWenliEmoji(emoji)).toBe(true);
    expect(cleanWenliReply(`前${emoji}后`)).toBe("前后");
    expect(hasWenliEmoji(cleanWenliReply(`前${emoji}后`))).toBe(false);
  });

  it("keeps paragraph spacing and emoticons around several emoji", () => {
    expect(cleanWenliReply("  我在😀呀 (＾▽＾)\n\n1️⃣公式 ±×∞ 和 https://example.com/#x 🐧\n"))
      .toBe("我在呀 (＾▽＾)\n\n公式 ±×∞ 和 https://example.com/#x");
  });

  it("removes an orphan skin modifier without deleting its ordinary text base", () => {
    expect(cleanWenliReply("a🏽 ©🏻 1🏿 前🏾后")).toBe("a © 1 前后");
  });

  it.each(["", " \n\t ", " 🐧 👩🏾‍💻 🇨🇳 1️⃣ ", "♥☀©️", "🏽️"])(
    "rejects empty visible output without inventing a fallback: %s", text => {
      expect(() => cleanWenliReply(text)).toThrowError(new Error("Wenli reply invalid"));
    }
  );
});
