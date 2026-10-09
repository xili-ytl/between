import type { AccountId, MessageRecord } from "./contracts.js";
import { IMAGE_MESSAGE_PLACEHOLDER } from "./contracts.js";

// The mention may be inserted at a middle cursor position, but both sides
// must still be explicit token boundaries. `@问理你好` is not a mention.
const WENLI_MENTION_TOKEN = /(?:^|[\s，,：:])@问理(?=$|[\s，,：:])/u;

export function isWenliMention(body: string): boolean {
  return WENLI_MENTION_TOKEN.test(body);
}

export function isHumanWenliMention<T extends Pick<MessageRecord, "senderId" | "type" | "body">>(
  message: T
): message is T & { senderId: AccountId } {
  if ((message.senderId !== "1001" && message.senderId !== "1002") || typeof message.body !== "string") {
    return false;
  }
  if (message.type === "image") {
    return message.body.trim() !== IMAGE_MESSAGE_PLACEHOLDER && isWenliMention(message.body);
  }
  return isWenliMention(message.body);
}
