const graphemes = new Intl.Segmenter("zh", { granularity: "grapheme" });
const emojiPresentation = /\p{Emoji_Presentation}/u;
const emojiWithPresentationSelector = /\p{Emoji}\uFE0F/u;
const keycap = /[#*0-9]\uFE0F?\u20E3/u;
const pictograph = /\p{Extended_Pictographic}/u;
const ordinarySymbol = /[©®™]|\p{Math_Symbol}/u;
const skinModifier = /\p{Emoji_Modifier}[\uFE0E\uFE0F]*/gu;

function isEmojiGrapheme(segment: string): boolean {
  if (emojiPresentation.test(segment) || emojiWithPresentationSelector.test(segment) || keycap.test(segment)) {
    return true;
  }
  // Text-style pictographs can render as emoji on another client. Keep ordinary
  // copyright/trademark and mathematical symbols unless explicitly emoji-styled.
  for (const character of segment) {
    if (pictograph.test(character) && !ordinarySymbol.test(character)) return true;
  }
  return false;
}

/** Apply only to newly generated visible replies, never historical or human text. */
export function cleanWenliReply(text: string): string {
  let cleaned = "";
  for (const { segment } of graphemes.segment(text)) {
    // A stray skin modifier joins an ordinary preceding letter in Unicode
    // segmentation. Remove it first so that malformed emoji cannot erase text.
    const withoutSkinModifiers = segment.replace(skinModifier, "");
    if (!isEmojiGrapheme(withoutSkinModifiers)) cleaned += withoutSkinModifiers;
  }
  cleaned = cleaned.trim();
  if (!cleaned) throw new Error("Wenli reply invalid");
  return cleaned;
}

export function hasWenliEmoji(text: string): boolean {
  for (const { segment } of graphemes.segment(text)) {
    if (isEmojiGrapheme(segment)) return true;
  }
  return false;
}
