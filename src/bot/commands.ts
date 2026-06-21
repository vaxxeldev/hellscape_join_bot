import type { Telegraf } from "telegraf";
import type { AppConfig } from "../config/env.js";
import { reloadConfig } from "../config/env.js";
import type { Repositories } from "../db/repositories.js";
import { isAdmin } from "../services/admin.js";
import { safeReplyWithBanner, safeRevokeInviteLink, withoutLinkPreview } from "../services/telegram.js";
import type { SubscriptionService } from "../services/subscriptions.js";
import type { FormService } from "./fsm.js";
import type { BotContext } from "../types.js";
import { mainMenuKeyboard } from "./keyboards.js";
import {
  activeReservationMessage,
  adminHelpMessage,
  adminOnlyCommandMessage,
  adminPanelMessage,
  applicationCard,
  applicationNotFoundMessage,
  applicationStatusMessage,
  applicationUserNotFoundMessage,
  applicationsListMessage,
  banResultMessage,
  banUsageMessage,
  changeReservationUsageMessage,
  cleanupApplicationsResultMessage,
  cleanupApplicationsUsageMessage,
  configReloadedMessage,
  helpMessage,
  noActiveReservationMessage,
  noApplicationsForAdminMessage,
  noApplicationsMessage,
  noReservationsMessage,
  openApplicationUsageMessage,
  reservationNotFoundMessage,
  reservationsListMessage,
  reservationStatusChangedMessage,
  rulesMessage,
  statsMessage,
  userNotFoundInDatabaseMessage,
  welcomeMessage,
  wipeDatabaseResultMessage,
  wipeDatabaseUsageMessage,
} from "./messages.js";

export class CommandHandlers {
  constructor(
    private readonly bot: Telegraf<BotContext>,
    private readonly repos: Repositories,
    private readonly forms: FormService,
    private readonly subscriptions: SubscriptionService,
    private readonly getConfig: () => AppConfig,
  ) {}

  register() {
    this.bot.start(async (ctx) => {
      if (ctx.from) {
        this.repos.upsertUser({
          telegramId: ctx.from.id,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
        });
      }
      await safeReplyWithBanner(ctx, "start_banner", welcomeMessage(), {
        parse_mode: "HTML",
        ...mainMenuKeyboard(this.getConfig()),
      });
    });

    this.bot.command("help", async (ctx) =>
      ctx.reply(helpMessage(), { parse_mode: "HTML", ...mainMenuKeyboard(this.getConfig()) }),
    );
    this.bot.command("rules", async (ctx) =>
      safeReplyWithBanner(ctx, "rules", rulesMessage(this.getConfig()), { parse_mode: "HTML" }),
    );
    this.bot.command("cancel", async (ctx) => this.forms.cancel(ctx));
    this.bot.command("reserve", async (ctx) => this.forms.startReservation(ctx));
    this.bot.command("status", async (ctx) => this.status(ctx));
    this.bot.command("my_reserve", async (ctx) => this.myReserve(ctx));

    this.bot.command("admin", async (ctx) => this.adminPanel(ctx));
    this.bot.command("help_admin", async (ctx) =>
      this.adminOnly(ctx, async () => {
        await ctx.reply(adminHelpMessage(), { parse_mode: "HTML" });
      }),
    );
    this.bot.command("stats", async (ctx) => this.stats(ctx));
    this.bot.command("applications", async (ctx) => this.applications(ctx));
    this.bot.command("app", async (ctx) => this.openApplication(ctx));
    this.bot.command("ban", async (ctx) => this.ban(ctx, true));
    this.bot.command("unban", async (ctx) => this.ban(ctx, false));
    this.bot.command("reload", async (ctx) => this.reload(ctx));
    this.bot.command("reservations", async (ctx) => this.reservations(ctx));
    this.bot.command("expire_reserve", async (ctx) => this.changeReservation(ctx, "expired"));
    this.bot.command("use_reserve", async (ctx) => this.changeReservation(ctx, "used"));
    this.bot.command("cleanup_applications", async (ctx) => this.cleanupApplications(ctx));
    this.bot.command("wipe_database", async (ctx) => this.wipeDatabase(ctx));
  }

  private async status(ctx: BotContext) {
    if (!ctx.from) return;
    const app = this.repos.getLatestApplicationByTelegramId(ctx.from.id);
    if (!app) {
      await ctx.reply(noApplicationsMessage(), mainMenuKeyboard(this.getConfig()));
      return;
    }
    await ctx.reply(applicationStatusMessage(app), {
      parse_mode: "HTML",
    });
  }

  private async myReserve(ctx: BotContext) {
    if (!ctx.from) return;
    const reservation = this.repos.getActiveReservationByTelegramId(ctx.from.id);
    if (!reservation) {
      await ctx.reply(noActiveReservationMessage());
      return;
    }
    await ctx.reply(activeReservationMessage(reservation), { parse_mode: "HTML" });
  }

  private async adminPanel(ctx: BotContext) {
    await this.adminOnly(ctx, async () => {
      const stats = this.repos.stats();
      await ctx.reply(adminPanelMessage(stats), { parse_mode: "HTML" });
    });
  }

  private async stats(ctx: BotContext) {
    await this.adminOnly(ctx, async () => {
      const stats = this.repos.stats();
      await ctx.reply(statsMessage(stats), { parse_mode: "HTML" });
    });
  }

  private async applications(ctx: BotContext) {
    await this.adminOnly(ctx, async () => {
      const apps = this.repos.listApplications(10);
      if (!apps.length) {
        await ctx.reply(noApplicationsForAdminMessage());
        return;
      }
      await ctx.reply(applicationsListMessage(apps), { parse_mode: "HTML" });
    });
  }

  private async openApplication(ctx: BotContext) {
    await this.adminOnly(ctx, async () => {
      const id = Number(this.commandArgs(ctx)[0]);
      if (!Number.isInteger(id)) {
        await ctx.reply(openApplicationUsageMessage());
        return;
      }
      const app = this.repos.getApplicationById(id);
      if (!app) {
        await ctx.reply(applicationNotFoundMessage());
        return;
      }
      const user = this.repos.getUserById(app.user_id);
      if (!user) {
        await ctx.reply(applicationUserNotFoundMessage());
        return;
      }
      const check = await this.subscriptions.check(user.telegram_id);
      const previousCount = Math.max(0, this.repos.countApplicationsByUserId(user.id) - 1);
      await ctx.reply(applicationCard(app, user, check, previousCount), withoutLinkPreview({ parse_mode: "HTML" }));
    });
  }

  private async ban(ctx: BotContext, isBanned: boolean) {
    await this.adminOnly(ctx, async () => {
      const raw = this.commandArgs(ctx)[0];
      if (!raw) {
        await ctx.reply(banUsageMessage(isBanned), { parse_mode: "HTML" });
        return;
      }
      const user = this.resolveUser(raw);
      if (!user) {
        await ctx.reply(userNotFoundInDatabaseMessage());
        return;
      }
      this.repos.setUserBanned(user.telegram_id, isBanned, isBanned ? "manual" : null);
      this.repos.logAdminAction({
        adminId: ctx.from!.id,
        action: isBanned ? "user_banned" : "user_unbanned",
        targetUserId: user.telegram_id,
      });
      await ctx.reply(banResultMessage(user, isBanned), { parse_mode: "HTML" });
    });
  }

  // Resolve a command target that may be a numeric telegram_id or an @username.
  // Usernames are looked up in the bot's own user table (Telegram does not let
  // bots resolve arbitrary @username -> id), so the user must be known already.
  private resolveUser(raw: string) {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) return this.repos.getUserByTelegramId(Number(trimmed));
    const username = trimmed.replace(/^@/, "");
    if (!username) return undefined;
    return this.repos.getUserByUsername(username);
  }

  private async reload(ctx: BotContext) {
    await this.adminOnly(ctx, async () => {
      reloadConfig();
      await ctx.reply(configReloadedMessage());
    });
  }

  private async reservations(ctx: BotContext) {
    await this.adminOnly(ctx, async () => {
      const reservations = this.repos.listReservations(["pending", "approved"], 20);
      if (!reservations.length) {
        await ctx.reply(noReservationsMessage());
        return;
      }
      await ctx.reply(reservationsListMessage(reservations), { parse_mode: "HTML" });
    });
  }

  private async changeReservation(ctx: BotContext, status: "expired" | "used") {
    await this.adminOnly(ctx, async () => {
      const id = Number(this.commandArgs(ctx)[0]);
      if (!Number.isInteger(id)) {
        await ctx.reply(changeReservationUsageMessage(status));
        return;
      }
      const reservation = this.repos.getReservationById(id);
      if (!reservation) {
        await ctx.reply(reservationNotFoundMessage());
        return;
      }
      this.repos.updateReservationStatus(id, status, ctx.from!.id);
      this.repos.logAdminAction({
        adminId: ctx.from!.id,
        action: status === "expired" ? "reservation_expired_manual" : "reservation_used",
        details: `reservation ${id}`,
      });
      await ctx.reply(reservationStatusChangedMessage(id, status), { parse_mode: "HTML" });
    });
  }

  private async cleanupApplications(ctx: BotContext) {
    await this.adminOnly(ctx, async () => {
      const [date, confirmation] = this.commandArgs(ctx);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || confirmation !== "CONFIRM") {
        await ctx.reply(cleanupApplicationsUsageMessage(), { parse_mode: "HTML" });
        return;
      }

      const result = this.repos.cleanupApplicationsByDate(date);
      let revokedInviteLinks = 0;
      let failedInviteRevokes = 0;
      for (const invite of result.activeInviteLinks) {
        const revoked = await safeRevokeInviteLink(this.bot, this.getConfig().mainChatId, invite.invite_link);
        if (revoked) revokedInviteLinks += 1;
        else failedInviteRevokes += 1;
      }

      this.repos.logAdminAction({
        adminId: ctx.from!.id,
        action: "applications_cleanup",
        details: `date=${date}; applications=${result.applications}; invite_links=${result.inviteLinks}; join_requests=${result.joinRequests}`,
      });

      await ctx.reply(
        cleanupApplicationsResultMessage({
          date,
          ...result,
          revokedInviteLinks,
          failedInviteRevokes,
        }),
        { parse_mode: "HTML" },
      );
    });
  }

  private async wipeDatabase(ctx: BotContext) {
    await this.adminOnly(ctx, async () => {
      const [confirmation] = this.commandArgs(ctx);
      if (confirmation !== "CONFIRM_FULL_WIPE") {
        await ctx.reply(wipeDatabaseUsageMessage(), { parse_mode: "HTML" });
        return;
      }

      const result = this.repos.wipeAllData();
      let revokedInviteLinks = 0;
      let failedInviteRevokes = 0;
      for (const invite of result.activeInviteLinks) {
        const revoked = await safeRevokeInviteLink(this.bot, this.getConfig().mainChatId, invite.invite_link);
        if (revoked) revokedInviteLinks += 1;
        else failedInviteRevokes += 1;
      }

      await ctx.reply(
        wipeDatabaseResultMessage({
          ...result,
          revokedInviteLinks,
          failedInviteRevokes,
        }),
        { parse_mode: "HTML" },
      );
    });
  }

  private async adminOnly(ctx: BotContext, fn: () => Promise<void>) {
    if (!isAdmin(this.getConfig(), ctx.from?.id)) {
      await ctx.reply(adminOnlyCommandMessage());
      return;
    }
    await fn();
  }

  private commandArgs(ctx: BotContext) {
    const message = ctx.message;
    const text = message && "text" in message ? String(message.text) : "";
    return text.trim().split(/\s+/).slice(1);
  }
}
