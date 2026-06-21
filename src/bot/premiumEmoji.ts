import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger.js";

const premiumEmojiNames = [
  "settings",
  "profile",
  "people",
  "userApproved",
  "userRejected",
  "file",
  "smile",
  "growthChart",
  "statsChart",
  "home",
  "lockClosed",
  "lockOpen",
  "announcement",
  "check",
  "cross",
  "pencil",
  "trash",
  "down",
  "attach",
  "link",
  "info",
  "bot",
  "eye",
  "hidden",
  "send",
  "download",
  "notification",
  "gift",
  "clock",
  "celebration",
  "font",
  "write",
  "media",
  "location",
  "wallet",
  "box",
  "cryptoBot",
  "calendar",
  "tag",
  "elapsed",
  "apps",
  "brush",
  "addText",
  "format",
  "money",
  "sendMoney",
  "receiveMoney",
  "code",
  "loading",
] as const;

export type PremiumEmojiName = (typeof premiumEmojiNames)[number];

export const premiumEmoji = loadPremiumEmoji();

function loadPremiumEmoji() {
  const configPath = path.resolve(process.cwd(), "premium_emoji.json");
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<Record<PremiumEmojiName, unknown>>;
    return Object.fromEntries(
      premiumEmojiNames.map((name) => [name, typeof raw[name] === "string" ? raw[name] : ""]),
    ) as Record<PremiumEmojiName, string>;
  } catch (error) {
    logger.warn({ error, configPath }, "failed to load premium emoji config");
    return Object.fromEntries(premiumEmojiNames.map((name) => [name, ""])) as Record<PremiumEmojiName, string>;
  }
}

type ButtonBase = {
  text: string;
  icon_custom_emoji_id?: string;
  style?: ButtonStyle;
};

export type ButtonStyle = "danger" | "success" | "primary";

type CallbackButton = ButtonBase & {
  callback_data: string;
};

type UrlButton = ButtonBase & {
  url: string;
};

export type PremiumInlineButton = CallbackButton | UrlButton;

export function pe(id: string | undefined, fallback: string) {
  if (!id) return fallback;
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
}

export function callbackButton(
  text: string,
  callbackData: string,
  iconCustomEmojiId?: string,
  style?: ButtonStyle,
): PremiumInlineButton {
  return {
    text,
    callback_data: callbackData,
    icon_custom_emoji_id: iconCustomEmojiId,
    style,
  };
}

export function urlButton(text: string, url: string, iconCustomEmojiId?: string, style?: ButtonStyle): PremiumInlineButton {
  return {
    text,
    url,
    icon_custom_emoji_id: iconCustomEmojiId,
    style,
  };
}

export function inlineKeyboard(inline_keyboard: PremiumInlineButton[][]) {
  return {
    reply_markup: {
      inline_keyboard,
    },
  };
}
