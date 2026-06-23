import { Telegraf } from "telegraf";
import { HttpsProxyAgent } from "https-proxy-agent";
import { loadConfig } from "./config/env.js";
import { Database } from "./db/database.js";
import { Repositories } from "./db/repositories.js";
import { CallbackHandlers } from "./bot/callbacks.js";
import { CommandHandlers } from "./bot/commands.js";
import { DeveloperHandlers } from "./bot/developer.js";
import { FormService } from "./bot/fsm.js";
import { JoinRequestHandlers } from "./bot/joinRequests.js";
import { mainMenuKeyboard } from "./bot/keyboards.js";
import { createThrottle } from "./bot/throttle.js";
import { logger } from "./utils/logger.js";
import { SubscriptionService } from "./services/subscriptions.js";
import { RoleService } from "./services/roles.js";
const config = loadConfig();
const db = new Database(config.databaseUrl);
const repos = new Repositories(db);
const telegramAgent = config.telegramProxyUrl ? new HttpsProxyAgent(config.telegramProxyUrl) : undefined;
const bot = new Telegraf(config.botToken, {
    telegram: {
        apiRoot: config.telegramApiRoot,
        agent: telegramAgent,
    },
});
const getConfig = loadConfig;
const subscriptions = new SubscriptionService(bot, getConfig);
const roles = new RoleService(repos, getConfig);
const forms = new FormService(bot, repos, subscriptions, roles, getConfig);
const callbacks = new CallbackHandlers(bot, repos, subscriptions, forms, getConfig);
const commands = new CommandHandlers(bot, repos, forms, subscriptions, getConfig);
const developer = new DeveloperHandlers(bot, repos, roles, getConfig);
const joinRequests = new JoinRequestHandlers(bot, repos, subscriptions, getConfig);
bot.catch((error, ctx) => {
    logger.error({ error, updateType: ctx.updateType }, "unhandled bot error");
});
bot.use(createThrottle(getConfig));
bot.use(async (ctx, next) => {
    const config = getConfig();
    const isMainChatInteraction = (ctx.updateType === "message" || ctx.updateType === "callback_query") &&
        ctx.chat?.id === config.mainChatId;
    if (isMainChatInteraction && ctx.from?.id !== config.developerId)
        return;
    return next();
});
commands.register();
developer.register();
callbacks.register();
joinRequests.register();
bot.on("message", async (ctx, next) => {
    const handledDeveloperMessage = await developer.handleMessage(ctx);
    if (handledDeveloperMessage)
        return;
    return next();
});
bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/"))
        return;
    const handledRejectReason = await callbacks.handleRejectReasonText(ctx, text);
    if (handledRejectReason)
        return;
    if (ctx.chat.type !== "private")
        return;
    const handledForm = await forms.continueText(ctx, text);
    if (handledForm)
        return;
    await ctx.reply("Я принимаю только анкеты на вступление и заявки на бронь ролей.\nВыберите действие ниже.", mainMenuKeyboard(getConfig()));
});
async function expireInviteLinks() {
    const expired = repos.expireOldInviteLinks();
    for (const invite of expired) {
        await safeRevokeExpiredInvite(invite.invite_link);
    }
}
async function safeRevokeExpiredInvite(inviteLink) {
    try {
        await bot.telegram.revokeChatInviteLink(getConfig().mainChatId, inviteLink);
    }
    catch (error) {
        logger.warn({ error, inviteLink }, "failed to revoke expired invite link");
    }
}
void expireInviteLinks();
void forms.expireReservations();
void forms.checkWaitlistQueue();
const reservationIntervalMs = getConfig().reservationExpireCheckHours * 60 * 60 * 1000;
const timer = setInterval(() => {
    void expireInviteLinks();
    void forms.expireReservations();
    void forms.checkWaitlistQueue();
}, reservationIntervalMs);
await launchWithRetry();
logger.info("Flood Games Join Bot started");
async function launchWithRetry() {
    const retryMs = getConfig().launchRetrySeconds * 1000;
    while (true) {
        try {
            await bot.launch({
                allowedUpdates: ["message", "callback_query", "chat_join_request", "chat_member", "my_chat_member"],
            });
            return;
        }
        catch (error) {
            logger.error({ error, retryInSeconds: getConfig().launchRetrySeconds, apiRoot: getConfig().telegramApiRoot }, "failed to launch bot, retrying");
            await new Promise((resolve) => setTimeout(resolve, retryMs));
        }
    }
}
function shutdown(signal) {
    logger.info({ signal }, "shutting down");
    clearInterval(timer);
    bot.stop(signal);
    db.close();
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
