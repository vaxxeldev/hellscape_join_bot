import type { Telegraf } from "telegraf";
import type { AppConfig } from "../config/env.js";
import type { Repositories } from "../db/repositories.js";
import { safeSendMessage } from "./telegram.js";
import type { BotContext, UserRecord } from "../types.js";
import { logger } from "../utils/logger.js";

// Called once per successful join into the main chat through the bot.
// Counts the join and, once the user has joined `maxJoinsBeforeBan` times,
// auto-bans them: they can no longer submit applications or reservations until
// an admin runs /unban (which resets the counter for a fresh set of attempts).
export async function enforceJoinLimit(
  bot: Telegraf<BotContext>,
  repos: Repositories,
  config: AppConfig,
  user: UserRecord,
) {
  const joins = repos.incrementJoinCount(user.id);
  if (user.is_banned) return;
  if (joins < config.maxJoinsBeforeBan) return;

  repos.setUserBanned(user.telegram_id, true, "join_limit");
  repos.logAdminAction({
    adminId: 0,
    action: "user_autobanned_join_limit",
    targetUserId: user.telegram_id,
    details: `joined ${joins} times`,
  });
  logger.info({ telegramId: user.telegram_id, joins }, "user auto-banned after reaching join limit");

  await safeSendMessage(
    bot,
    config.adminChatId,
    `🔒 <b>Авто-бан по лимиту входов</b>\nПользователь <code>${user.telegram_id}</code> заходил в основной чат через бота ${joins} раз и больше не может подавать анкеты и брони.\nСнять ограничение: <code>/unban ${user.telegram_id}</code>`,
    { parse_mode: "HTML" },
  );
}
