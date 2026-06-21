import { isAdmin } from "../services/admin.js";
import { logger } from "../utils/logger.js";
// Per-user sliding-window throttle. Drops bursts of updates from a single user
// so a spammer can't flood the admin chat or hit Telegram API rate limits.
// Admins are exempt; warnings and logs are debounced to one per window.
export function createThrottle(getConfig) {
    const hits = new Map();
    const sweep = setInterval(() => {
        const cutoff = Date.now() - getConfig().rateLimitWindowSeconds * 1000;
        for (const [userId, entry] of hits) {
            entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);
            if (!entry.timestamps.length && entry.lastNotifiedAt <= cutoff)
                hits.delete(userId);
        }
    }, 60_000);
    sweep.unref?.();
    return async (ctx, next) => {
        const userId = ctx.from?.id;
        if (typeof userId !== "number")
            return next();
        const config = getConfig();
        if (isAdmin(config, userId))
            return next();
        const windowMs = config.rateLimitWindowSeconds * 1000;
        const now = Date.now();
        const cutoff = now - windowMs;
        const entry = hits.get(userId) ?? { timestamps: [], lastNotifiedAt: 0 };
        entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);
        if (entry.timestamps.length >= config.rateLimitMaxUpdates) {
            const shouldNotify = now - entry.lastNotifiedAt > windowMs;
            if (shouldNotify)
                entry.lastNotifiedAt = now;
            hits.set(userId, entry);
            if (ctx.callbackQuery) {
                await ctx
                    .answerCbQuery(shouldNotify ? "Слишком часто. Подождите пару секунд." : undefined)
                    .catch(() => { });
            }
            else if (shouldNotify) {
                await ctx.reply("Слишком много сообщений подряд. Подождите немного.").catch(() => { });
            }
            if (shouldNotify)
                logger.warn({ userId, updateType: ctx.updateType }, "throttled user");
            return;
        }
        entry.timestamps.push(now);
        hits.set(userId, entry);
        return next();
    };
}
