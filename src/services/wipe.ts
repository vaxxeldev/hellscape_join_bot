import type { Telegraf } from "telegraf";
import type { AppConfig } from "../config/env.js";
import type { Repositories } from "../db/repositories.js";
import type { BotContext } from "../types.js";
import { safeRevokeInviteLink } from "./telegram.js";

export async function wipeDatabaseWithTelegram(
  bot: Telegraf<BotContext>,
  repos: Repositories,
  getConfig: () => AppConfig,
) {
  const result = repos.wipeAllData();
  let revokedInviteLinks = 0;
  let failedInviteRevokes = 0;

  for (const invite of result.activeInviteLinks) {
    const revoked = await safeRevokeInviteLink(bot, getConfig().mainChatId, invite.invite_link);
    if (revoked) revokedInviteLinks += 1;
    else failedInviteRevokes += 1;
  }

  return {
    ...result,
    revokedInviteLinks,
    failedInviteRevokes,
  };
}
