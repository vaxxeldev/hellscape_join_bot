import "dotenv/config";
import dotenv from "dotenv";
import { z } from "zod";
const boolFromString = z
    .string()
    .optional()
    .transform((value) => value !== "false");
const csvIds = z
    .string()
    .optional()
    .transform((value, ctx) => (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
    const id = Number(part);
    if (!Number.isInteger(id)) {
        ctx.addIssue({
            code: "custom",
            message: `Expected numeric Telegram user IDs separated by commas, got "${part}"`,
        });
        return z.NEVER;
    }
    return id;
}));
const optionalId = z
    .string()
    .optional()
    .transform((value, ctx) => {
    const trimmed = (value ?? "").trim();
    if (!trimmed)
        return undefined;
    const id = Number(trimmed);
    if (!Number.isFinite(id)) {
        ctx.addIssue({
            code: "custom",
            message: "Expected a numeric Telegram user ID",
        });
        return z.NEVER;
    }
    return id;
});
const schema = z.object({
    BOT_TOKEN: z.string().min(1),
    LIFE_CHANNEL_ID: z.coerce.number(),
    INFO_CHANNEL_ID: z.coerce.number(),
    MAIN_CHAT_ID: z.coerce.number(),
    ADMIN_CHAT_ID: z.coerce.number(),
    RULES_URL: z.string().url(),
    LIFE_CHANNEL_URL: z.string().url(),
    INFO_CHANNEL_URL: z.string().url(),
    ROLE_POST_GENSHIN_URL: z.string().url(),
    ROLE_POST_HSR_URL: z.string().url(),
    CODE_WORD: z.string().min(1),
    DEVELOPER_ID: optionalId,
    OWNER_ID: z.coerce.number(),
    SENIOR_ADMIN_IDS: csvIds,
    JUNIOR_ADMIN_IDS: csvIds,
    CO_OWNER_IDS: csvIds,
    INVITE_EXPIRE_HOURS: z.coerce.number().int().positive().default(24),
    DATABASE_URL: z.string().default("file:./data/flood_games.sqlite"),
    AUTO_DECLINE_INVALID_JOIN_REQUESTS: boolFromString.default(true),
    RESERVATION_EXPIRE_CHECK_HOURS: z.coerce.number().int().positive().default(3),
    MAIN_CHAT_MEMBER_LIMIT: z.coerce.number().int().positive().default(60),
    TELEGRAM_API_ROOT: z.string().url().default("https://api.telegram.org"),
    TELEGRAM_PROXY_URL: z.string().url().optional().or(z.literal("")),
    LAUNCH_RETRY_SECONDS: z.coerce.number().int().positive().default(15),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_MAX_UPDATES: z.coerce.number().int().positive().default(15),
    MAX_APPLICATIONS_PER_DAY: z.coerce.number().int().positive().default(5),
    MAX_JOINS_BEFORE_BAN: z.coerce.number().int().positive().default(3),
});
let currentConfig = parseConfig();
function parseConfig() {
    const parsed = schema.parse(process.env);
    const adminIds = new Set([
        ...(parsed.DEVELOPER_ID ? [parsed.DEVELOPER_ID] : []),
        parsed.OWNER_ID,
        ...parsed.CO_OWNER_IDS,
        ...parsed.SENIOR_ADMIN_IDS,
        ...parsed.JUNIOR_ADMIN_IDS,
    ]);
    return {
        botToken: parsed.BOT_TOKEN,
        lifeChannelId: parsed.LIFE_CHANNEL_ID,
        infoChannelId: parsed.INFO_CHANNEL_ID,
        mainChatId: parsed.MAIN_CHAT_ID,
        adminChatId: parsed.ADMIN_CHAT_ID,
        rulesUrl: parsed.RULES_URL,
        lifeChannelUrl: parsed.LIFE_CHANNEL_URL,
        infoChannelUrl: parsed.INFO_CHANNEL_URL,
        rolePostUrls: {
            genshin: parsed.ROLE_POST_GENSHIN_URL,
            hsr: parsed.ROLE_POST_HSR_URL,
        },
        codeWord: parsed.CODE_WORD,
        developerId: parsed.DEVELOPER_ID,
        ownerId: parsed.OWNER_ID,
        coOwnerIds: parsed.CO_OWNER_IDS,
        seniorAdminIds: parsed.SENIOR_ADMIN_IDS,
        juniorAdminIds: parsed.JUNIOR_ADMIN_IDS,
        adminIds,
        inviteExpireHours: parsed.INVITE_EXPIRE_HOURS,
        databaseUrl: parsed.DATABASE_URL,
        autoDeclineInvalidJoinRequests: parsed.AUTO_DECLINE_INVALID_JOIN_REQUESTS,
        reservationExpireCheckHours: parsed.RESERVATION_EXPIRE_CHECK_HOURS,
        mainChatMemberLimit: parsed.MAIN_CHAT_MEMBER_LIMIT,
        telegramApiRoot: parsed.TELEGRAM_API_ROOT,
        telegramProxyUrl: parsed.TELEGRAM_PROXY_URL || undefined,
        launchRetrySeconds: parsed.LAUNCH_RETRY_SECONDS,
        rateLimitWindowSeconds: parsed.RATE_LIMIT_WINDOW_SECONDS,
        rateLimitMaxUpdates: parsed.RATE_LIMIT_MAX_UPDATES,
        maxApplicationsPerDay: parsed.MAX_APPLICATIONS_PER_DAY,
        maxJoinsBeforeBan: parsed.MAX_JOINS_BEFORE_BAN,
    };
}
export function loadConfig() {
    return currentConfig;
}
export function reloadConfig() {
    dotenv.config({ override: true });
    currentConfig = parseConfig();
    return currentConfig;
}
