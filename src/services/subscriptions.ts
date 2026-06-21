import type { Telegraf } from "telegraf";
import type { AppConfig } from "../config/env.js";
import type { BotContext, SubscriptionCheck } from "../types.js";
import { logger } from "../utils/logger.js";

const validStatuses = new Set(["creator", "administrator", "member"]);
const positiveSubscriptionCacheMs = 60_000;
const negativeSubscriptionCacheMs = 3_000;
const maxSubscriptionCacheEntries = 5000;

type SubscriptionCacheEntry = {
  expiresAt: number;
  value?: boolean;
  inFlight?: Promise<boolean>;
};

export class SubscriptionService {
  private readonly cache = new Map<string, SubscriptionCacheEntry>();

  constructor(
    private readonly bot: Telegraf<BotContext>,
    private readonly getConfig: () => AppConfig,
  ) {}

  async check(userId: number): Promise<SubscriptionCheck> {
    const config = this.getConfig();
    const [life, info] = await Promise.all([
      this.isSubscribed(config.lifeChannelId, userId),
      this.isSubscribed(config.infoChannelId, userId),
    ]);
    return { life, info };
  }

  async isMainChatMember(userId: number) {
    return this.isSubscribed(this.getConfig().mainChatId, userId);
  }

  private async isSubscribed(chatId: number, userId: number) {
    const key = `${chatId}:${userId}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached?.value !== undefined && cached.expiresAt > now) return cached.value;
    if (cached?.inFlight) return cached.inFlight;

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

  private async fetchSubscriptionStatus(chatId: number, userId: number) {
    try {
      const member = await this.bot.telegram.getChatMember(chatId, userId);
      if (validStatuses.has(member.status)) return true;
      if (member.status === "restricted" && "is_member" in member) return Boolean(member.is_member);
      return false;
    } catch (error) {
      logger.warn({ error, chatId, userId }, "failed to check channel subscription");
      return false;
    }
  }

  private sweepCache() {
    if (this.cache.size <= maxSubscriptionCacheEntries) return;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (!entry.inFlight && entry.expiresAt <= now) this.cache.delete(key);
    }
    if (this.cache.size <= maxSubscriptionCacheEntries) return;
    for (const key of this.cache.keys()) {
      this.cache.delete(key);
      if (this.cache.size <= maxSubscriptionCacheEntries) return;
    }
  }
}
