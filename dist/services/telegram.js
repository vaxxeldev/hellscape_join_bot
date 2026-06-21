import { Input } from "telegraf";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger.js";
const bannerFileIdCachePath = path.resolve(process.cwd(), "data", "banner_file_ids.json");
let bannerFileIdsCache = null;
const bannerExistsCache = new Map();
export async function safeSendMessage(bot, chatId, text, extra = {}) {
    try {
        return await bot.telegram.sendMessage(chatId, text, extra);
    }
    catch (error) {
        logger.warn({ error, chatId }, "failed to send telegram message");
        return null;
    }
}
function bannerPath(name) {
    return path.resolve(process.cwd(), "messages_banner_gif", `${name}.mp4`);
}
function bannerExists(name) {
    const cached = bannerExistsCache.get(name);
    if (typeof cached === "boolean")
        return cached;
    const exists = fs.existsSync(bannerPath(name));
    bannerExistsCache.set(name, exists);
    return exists;
}
function readBannerFileIds() {
    if (bannerFileIdsCache)
        return bannerFileIdsCache;
    try {
        if (!fs.existsSync(bannerFileIdCachePath)) {
            bannerFileIdsCache = {};
            return bannerFileIdsCache;
        }
        bannerFileIdsCache = JSON.parse(fs.readFileSync(bannerFileIdCachePath, "utf8"));
        return bannerFileIdsCache;
    }
    catch (error) {
        logger.warn({ error }, "failed to read banner file_id cache");
        bannerFileIdsCache = {};
        return bannerFileIdsCache;
    }
}
function writeBannerFileId(name, fileId) {
    try {
        const cache = readBannerFileIds();
        cache[name] = fileId;
        bannerFileIdsCache = cache;
        fs.mkdirSync(path.dirname(bannerFileIdCachePath), { recursive: true });
        fs.writeFileSync(bannerFileIdCachePath, JSON.stringify(cache, null, 2), "utf8");
    }
    catch (error) {
        logger.warn({ error, name }, "failed to write banner file_id cache");
    }
}
function animationFileId(message) {
    if (typeof message !== "object" || message === null || !("animation" in message))
        return null;
    const animation = message.animation;
    return typeof animation?.file_id === "string" ? animation.file_id : null;
}
export async function safeReplyWithBanner(ctx, banner, caption, extra = {}) {
    const filePath = bannerPath(banner);
    if (!bannerExists(banner))
        return ctx.reply(caption, extra);
    const cachedFileId = readBannerFileIds()[banner];
    try {
        const message = await ctx.replyWithAnimation(cachedFileId ?? Input.fromLocalFile(filePath), { ...extra, caption });
        const fileId = animationFileId(message);
        if (!cachedFileId && fileId)
            writeBannerFileId(banner, fileId);
        return message;
    }
    catch (error) {
        if (!cachedFileId) {
            logger.warn({ error, banner }, "failed to send banner animation");
            return ctx.reply(caption, extra);
        }
    }
    try {
        const message = await ctx.replyWithAnimation(Input.fromLocalFile(filePath), { ...extra, caption });
        const fileId = animationFileId(message);
        if (fileId)
            writeBannerFileId(banner, fileId);
        return message;
    }
    catch (error) {
        logger.warn({ error, banner }, "failed to send banner animation");
        return ctx.reply(caption, extra);
    }
}
export async function safeSendBanner(bot, chatId, banner, caption, extra = {}) {
    const filePath = bannerPath(banner);
    if (!bannerExists(banner))
        return safeSendMessage(bot, chatId, caption, extra);
    const cachedFileId = readBannerFileIds()[banner];
    try {
        const message = await bot.telegram.sendAnimation(chatId, cachedFileId ?? Input.fromLocalFile(filePath), { ...extra, caption });
        const fileId = animationFileId(message);
        if (!cachedFileId && fileId)
            writeBannerFileId(banner, fileId);
        return message;
    }
    catch (error) {
        if (!cachedFileId) {
            logger.warn({ error, chatId, banner }, "failed to send banner animation");
            return safeSendMessage(bot, chatId, caption, extra);
        }
    }
    try {
        const message = await bot.telegram.sendAnimation(chatId, Input.fromLocalFile(filePath), { ...extra, caption });
        const fileId = animationFileId(message);
        if (fileId)
            writeBannerFileId(banner, fileId);
        return message;
    }
    catch (error) {
        logger.warn({ error, chatId, banner }, "failed to send banner animation");
        return safeSendMessage(bot, chatId, caption, extra);
    }
}
export function withoutLinkPreview(extra = {}) {
    return {
        ...extra,
        link_preview_options: { is_disabled: true },
    };
}
export async function safeRevokeInviteLink(bot, chatId, inviteLink) {
    try {
        await bot.telegram.revokeChatInviteLink(chatId, inviteLink);
        return true;
    }
    catch (error) {
        logger.warn({ error, chatId, inviteLink }, "failed to revoke invite link");
        return false;
    }
}
export async function safeAnswerCallback(ctx, text, alert = false) {
    try {
        await ctx.answerCbQuery(text, { show_alert: alert });
    }
    catch (error) {
        logger.warn({ error }, "failed to answer callback query");
    }
}
export async function safeEditMessageText(ctx, text, extra = {}) {
    try {
        return await ctx.editMessageText(text, extra);
    }
    catch (error) {
        if (isMessageNotModifiedError(error)) {
            logger.debug({ error }, "telegram message was not modified");
            return null;
        }
        logger.warn({ error }, "failed to edit telegram message");
        return null;
    }
}
export function isMessageNotModifiedError(error) {
    const description = typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof error.response === "object" &&
        error.response !== null &&
        "description" in error.response
        ? String(error.response.description)
        : "";
    return description.includes("message is not modified");
}
