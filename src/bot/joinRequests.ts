import type { Telegraf } from "telegraf";
import type { AppConfig } from "../config/env.js";
import type { Repositories } from "../db/repositories.js";
import type { SubscriptionService } from "../services/subscriptions.js";
import { enforceJoinLimit } from "../services/joinLimit.js";
import { safeRevokeInviteLink, safeSendMessage } from "../services/telegram.js";
import type { BotContext } from "../types.js";
import { logger } from "../utils/logger.js";
import { escapeHtml } from "../utils/text.js";
import { isPastIso } from "../utils/time.js";
import { pe, premiumEmoji } from "./premiumEmoji.js";
import { applicationStatusLabel, inviteLinkStatusLabel } from "./statusLabels.js";
import { sendJoinRequestForAdmin } from "./callbacks.js";
import type { FormService } from "./fsm.js";

export class JoinRequestHandlers {
  constructor(
    private readonly bot: Telegraf<BotContext>,
    private readonly repos: Repositories,
    private readonly subscriptions: SubscriptionService,
    private readonly forms: FormService,
    private readonly getConfig: () => AppConfig,
  ) {}

  register() {
    this.bot.on("chat_join_request", async (ctx) => this.handle(ctx));
    this.bot.on("chat_member", async (ctx) => this.handleChatMember(ctx));
  }

  private async handle(ctx: BotContext) {
    const request = ctx.chatJoinRequest;
    if (!request) return;
    if (request.chat.id !== this.getConfig().mainChatId) return;

    const from = request.from;
    const inviteUrl = request.invite_link?.invite_link;
    if (!inviteUrl) {
      await this.handleUnknownRequest(from.id, from.username, "заявка отправлена без invite-ссылки");
      return;
    }

    const invite = this.repos.getInviteLinkByUrl(inviteUrl);
    if (!invite) {
      await this.handleUnknownRequest(from.id, from.username, "ссылка не зарегистрирована ботом");
      return;
    }

    const user = this.repos.upsertUser({
      telegramId: from.id,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
    });

    const reasons: string[] = [];

    if (user.is_banned) reasons.push("пользователь заблокирован в базе бота");
    const app = invite.application_id ? this.repos.getApplicationById(invite.application_id) : undefined;
    const reservation = invite.reservation_id ? this.repos.getReservationById(invite.reservation_id) : undefined;
    if (invite.user_id !== user.id) reasons.push("пользователь не является владельцем ссылки");
    if (invite.status !== "active") reasons.push(`статус ссылки: ${inviteLinkStatusLabel(invite.status)}`);
    if (isPastIso(invite.expires_at)) reasons.push("срок ссылки истек");
    if (invite.application_id) {
      if (!app) reasons.push("связанная анкета не найдена");
      if (app && app.status !== "approved") reasons.push(`анкета не одобрена: ${applicationStatusLabel(app.status, app.reject_reason)}`);
    } else if (invite.reservation_id) {
      if (!reservation) reasons.push("связанная бронь не найдена");
      if (reservation && reservation.status !== "approved") reasons.push(`бронь не активна: ${reservation.status}`);
    } else {
      reasons.push("у ссылки нет связанной анкеты или брони");
    }

    const check = await this.subscriptions.check(from.id);
    if (!check.life || !check.info) reasons.push("пользователь больше не подписан на оба канала");

    if (reasons.length) {
      this.repos.createJoinRequest({
        applicationId: app?.id ?? null,
        reservationId: reservation?.id ?? null,
        userId: user.id,
        inviteLinkId: invite.id,
        status: "rejected",
      });
      await safeSendMessage(
        this.bot,
        this.getConfig().adminChatId,
        `${pe(premiumEmoji.cross, "❌")} <b>Невалидная заявка на вход в основной чат</b>\n\nПользователь: <code>${from.id}</code> ${escapeHtml(
          from.username ? `@${from.username}` : "no_username",
        )}\nПричины: ${escapeHtml(reasons.join("; "))}`,
        { parse_mode: "HTML" },
      );
      if (this.getConfig().autoDeclineInvalidJoinRequests) {
        await this.declineTelegramJoinRequest(from.id);
        this.repos.setInviteLinkStatus(invite.id, "revoked");
        await safeRevokeInviteLink(this.bot, this.getConfig().mainChatId, invite.invite_link);
        await this.releaseInvalidReservation(reservation?.id);
      }
      return;
    }

    const joinRequest = this.repos.createJoinRequest({
      applicationId: app?.id ?? null,
      reservationId: reservation?.id ?? null,
      userId: user.id,
      inviteLinkId: invite.id,
      status: "pending",
    });
    // Consume the personal link on the first valid request. Telegram may approve
    // the pending request later, so chat_member accepts both active and pending.
    this.repos.setInviteLinkStatus(invite.id, "pending");
    await sendJoinRequestForAdmin(this.bot, this.repos, this.getConfig(), joinRequest.id, this.subscriptions);
  }

  private async handleUnknownRequest(userId: number, username: string | undefined, reason: string) {
    await safeSendMessage(
      this.bot,
      this.getConfig().adminChatId,
      `${pe(premiumEmoji.cross, "❌")} <b>Неизвестная заявка на вход</b>\n\nПользователь: <code>${userId}</code> ${escapeHtml(
        username ? `@${username}` : "no_username",
      )}\nПричина: ${escapeHtml(reason)}`,
      { parse_mode: "HTML" },
    );
    if (this.getConfig().autoDeclineInvalidJoinRequests) await this.declineTelegramJoinRequest(userId);
  }

  private async releaseInvalidReservation(reservationId: number | undefined) {
    if (!reservationId) return;
    const reservation = this.repos.getReservationById(reservationId);
    if (!reservation || reservation.status !== "approved") return;
    this.repos.updateReservationStatus(reservation.id, "expired", null, "Персональная ссылка отозвана");
    if (reservation.reservation_kind === "waitlist") await this.forms.checkWaitlistQueue();
  }

  private async declineTelegramJoinRequest(userId: number) {
    try {
      await this.bot.telegram.declineChatJoinRequest(this.getConfig().mainChatId, userId);
    } catch (error) {
      logger.warn({ error, userId }, "failed to decline invalid join request");
    }
  }

  private async handleChatMember(ctx: BotContext) {
    const chatMember = ctx.chatMember;
    if (!chatMember || chatMember.chat.id !== this.getConfig().mainChatId) return;

    const oldStatus = chatMember.old_chat_member.status;
    const newStatus = chatMember.new_chat_member.status;
    const memberStatuses = new Set(["member", "administrator", "creator"]);
    if (memberStatuses.has(oldStatus) || !memberStatuses.has(newStatus)) return;

    const inviteUrl = chatMember.invite_link?.invite_link;
    if (!inviteUrl) return;

    const invite = this.repos.getInviteLinkByUrl(inviteUrl);
    if (!invite || !["active", "pending"].includes(invite.status)) return;

    const joinedTelegramId = chatMember.new_chat_member.user.id;
    const joinedUser = this.repos.getUserById(invite.user_id);
    if (!joinedUser || joinedUser.telegram_id !== joinedTelegramId) {
      this.repos.setInviteLinkStatus(invite.id, "revoked");
      await safeRevokeInviteLink(this.bot, this.getConfig().mainChatId, invite.invite_link);
      await safeSendMessage(
        this.bot,
        this.getConfig().adminChatId,
        `${pe(premiumEmoji.cross, "❌")} <b>Нарушена персональность ссылки</b>\nСсылка пользователя <code>${joinedUser?.telegram_id ?? "unknown"}</code> была использована участником <code>${joinedTelegramId}</code>. Проверьте участника вручную.`,
        { parse_mode: "HTML" },
      );
      await this.releaseInvalidReservation(invite.reservation_id ?? undefined);
      return;
    }

    const app = invite.application_id ? this.repos.getApplicationById(invite.application_id) : undefined;
    const reservation = invite.reservation_id ? this.repos.getReservationById(invite.reservation_id) : undefined;
    this.repos.setInviteLinkStatus(invite.id, "used");
    this.repos.markJoinRequestApprovedByInviteLinkId(invite.id);
    if (app) this.repos.updateApplicationStatus(app.id, "joined", app.reviewed_by_admin_id);
    if (reservation) this.repos.updateReservationStatus(reservation.id, "used", reservation.reviewed_by_admin_id);
    await safeRevokeInviteLink(this.bot, this.getConfig().mainChatId, invite.invite_link);

    await enforceJoinLimit(this.bot, this.repos, this.getConfig(), joinedUser);
    if (reservation?.reservation_kind === "waitlist") await this.forms.checkWaitlistQueue();
  }
}
