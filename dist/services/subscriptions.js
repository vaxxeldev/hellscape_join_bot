import { logger } from "../utils/logger.js";
const validStatuses = new Set(["creator", "administrator", "member"]);
const positiveSubscriptionCacheMs = 60_000;
const negativeSubscriptionCacheMs = 3_000;
const maxSubscriptionCacheEntries = 5000;
export class SubscriptionService {
    bot;
    getConfig;
    cache = new Map();
    constructor(bot, getConfig) {
        this.bot = bot;
        this.getConfig = getConfig;
    }
    async check(userId) {
        const config = this.getConfig();
        const [life, info] = await Promise.all([
            this.isSubscribed(config.lifeChannelId, userId),
            this.isSubscribed(config.infoChannelId, userId),
        ]);
        return { life, info };
    }
    async isMainChatMember(userId) {
        return this.isSubscribed(this.getConfig().mainChatId, userId);
    }
    async isSubscribed(chatId, userId) {
        const key = `${chatId}:${userId}`;
        const now = Date.now();
        const cached = this.cache.get(key);
        if (cached?.value !== undefined && cached.expiresAt > now)
            return cached.value;
        if (cached?.inFlight)
            return cached.inFlight;
        const inFlight = this.fetchSubscriptionStatus(chatId, userId).then((value) => {
            this.cache.set(key, {
                value,
                expiresAt: Date.now() + (value ? positiveSubscriptionCacheMs : negativeSubscriptionCacheMs),
            });
            this.sweepCache();
            return value;
        });
        this.cache.set(key, { expiresAt: 0, inFlight });
        return inFlight;
    }
    async fetchSubscriptionStatus(chatId, userId) {
        try {
            const member = await this.bot.telegram.getChatMember(chatId, userId);
            if (validStatuses.has(member.status))
                return true;
            if (member.status === "restricted" && "is_member" in member)
                return Boolean(member.is_member);
            return false;
        }
        catch (error) {
            logger.warn({ error, chatId, userId }, "failed to check channel subscription");
            return false;
        }
    }
    sweepCache() {
        if (this.cache.size <= maxSubscriptionCacheEntries)
            return;
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (!entry.inFlight && entry.expiresAt <= now)
                this.cache.delete(key);
        }
        if (this.cache.size <= maxSubscriptionCacheEntries)
            return;
        for (const key of this.cache.keys()) {
            this.cache.delete(key);
            if (this.cache.size <= maxSubscriptionCacheEntries)
                return;
        }
    }
}
