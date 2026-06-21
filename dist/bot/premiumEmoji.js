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
];
export const premiumEmoji = loadPremiumEmoji();
function loadPremiumEmoji() {
    const configPath = path.resolve(process.cwd(), "premium_emoji.json");
    try {
        const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
        return Object.fromEntries(premiumEmojiNames.map((name) => [name, typeof raw[name] === "string" ? raw[name] : ""]));
    }
    catch (error) {
        logger.warn({ error, configPath }, "failed to load premium emoji config");
        return Object.fromEntries(premiumEmojiNames.map((name) => [name, ""]));
    }
}
export function pe(id, fallback) {
    if (!id)
        return fallback;
    return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
}
export function callbackButton(text, callbackData, iconCustomEmojiId, style) {
    return {
        text,
        callback_data: callbackData,
        icon_custom_emoji_id: iconCustomEmojiId,
        style,
    };
}
export function urlButton(text, url, iconCustomEmojiId, style) {
    return {
        text,
        url,
        icon_custom_emoji_id: iconCustomEmojiId,
        style,
    };
}
export function inlineKeyboard(inline_keyboard) {
    return {
        reply_markup: {
            inline_keyboard,
        },
    };
}
