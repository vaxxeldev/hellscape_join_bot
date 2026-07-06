import { enforceJoinLimit } from "../services/joinLimit.js";
import { safeRevokeInviteLink, safeSendMessage } from "../services/telegram.js";
import { logger } from "../utils/logger.js";
import { escapeHtml } from "../utils/text.js";
import { isPastIso } from "../utils/time.js";
import { pe, premiumEmoji } from "./premiumEmoji.js";
import { applicationStatusLabel, inviteLinkStatusLabel } from "./statusLabels.js";
import { sendJoinRequestForAdmin } from "./callbacks.js";
export class JoinRequestHandlers {
    bot;
    repos;
    subscriptions;
    forms;
    getConfig;
    constructor(bot, repos, subscriptions, forms, getConfig) {
        this.bot = bot;
        this.repos = repos;
        this.subscriptions = subscriptions;
        this.forms = forms;
        this.getConfig = getConfig;
    }
    register() {
        this.bot.on("chat_join_request", async (ctx) => this.handle(ctx));
        this.bot.on("chat_member", async (ctx) => this.handleChatMember(ctx));
    }
    async handle(ctx) {
        const request = ctx.chatJoinRequest;
        if (!request)
            return;
        if (request.chat.id !== this.getConfig().mainChatId)
            return;
        const from = request.from;
        const inviteUrl = request.invite_link?.invite_link;
        if (!inviteUrl) {
            await this.handleUnknownRequest(from.id, from.username, "заявка отправлена без invite-ссылки");
            return;
        }
        const invite = this.repos.getInviteLinkByUrl(inviteUrl);
        if (!invite) {
            // Ссылка создана не ботом (владельцем/админом вручную в Telegram) —
            // бот на такие ссылки не реагирует: ни отклонения, ни сообщений в админ-чат.
            logger.debug({ userId: from.id, username: from.username }, "join request via link not tracked by bot, ignoring");
            return;
        }
        const user = this.repos.upsertUser({
            telegramId: from.id,
            username: from.username,
            firstName: from.first_name,
            lastName: from.last_name,
        });
        // Утечка ссылки: заявку подаёт не владелец — отклоняем и отзываем ссылку.
        // Это единственный случай, когда чужой заход инвалидирует персональную ссылку.
        if (invite.user_id !== user.id) {
            await this.rejectJoinRequest(invite, user.id, from, ["пользователь не является владельцем ссылки"]);
            await this.banLeakedLinkOwner(invite.user_id);
            return;
        }
        // Идемпотентность: атомарно занимаем ссылку active -> pending. Только первый
        // валидный заход владельца проходит дальше. Дубликаты Telegram (at-least-once)
        // и повторные клики по устаревшей ссылке проигрывают гонку и не отклоняют
        // уже поданную живую заявку.
        const consumed = this.repos.consumeActiveInviteLink(invite.id);
        if (!consumed) {
            await this.handleNonActiveOwnerRequest(invite.id, from);
            return;
        }
        const app = invite.application_id ? this.repos.getApplicationById(invite.application_id) : undefined;
        const reservation = invite.reservation_id ? this.repos.getReservationById(invite.reservation_id) : undefined;
        const reasons = [];
        if (user.is_banned)
            reasons.push("пользователь заблокирован в базе бота");
        if (isPastIso(invite.expires_at))
            reasons.push("срок ссылки истек");
        if (invite.application_id) {
            if (!app)
                reasons.push("связанная анкета не найдена");
            else if (app.status !== "approved")
                reasons.push(`анкета не одобрена: ${applicationStatusLabel(app.status, app.reject_reason)}`);
        }
        else if (invite.reservation_id) {
            if (!reservation)
                reasons.push("связанная бронь не найдена");
            else if (reservation.status !== "approved")
                reasons.push(`бронь не активна: ${reservation.status}`);
        }
        else {
            reasons.push("у ссылки нет связанной анкеты или брони");
        }
        const check = await this.subscriptions.check(from.id);
        if (!check.life || !check.info)
            reasons.push("пользователь больше не подписан на оба канала");
        if (reasons.length) {
            await this.rejectJoinRequest(invite, user.id, from, reasons, app?.id ?? null, reservation?.id ?? null);
            return;
        }
        // Заявка валидна. Ссылка уже переведена в pending атомарным consume выше;
        // Telegram одобрит заявку позже, поэтому chat_member принимает active и pending.
        const joinRequest = this.repos.createJoinRequest({
            applicationId: app?.id ?? null,
            reservationId: reservation?.id ?? null,
            userId: user.id,
            inviteLinkId: invite.id,
            status: "pending",
        });
        await sendJoinRequestForAdmin(this.bot, this.repos, this.getConfig(), joinRequest.id, this.subscriptions);
    }
    // Общий путь отклонения невалидной заявки: фиксируем rejected, уведомляем
    // админ-чат и (если включено) отклоняем заявку в Telegram, отзываем ссылку и
    // освобождаем связанную бронь.
    async rejectJoinRequest(invite, userId, from, reasons, applicationId = invite.application_id, reservationId = invite.reservation_id) {
        this.repos.createJoinRequest({
            applicationId,
            reservationId,
            userId,
            inviteLinkId: invite.id,
            status: "rejected",
        });
        await safeSendMessage(this.bot, this.getConfig().adminChatId, `${pe(premiumEmoji.cross, "❌")} <b>Невалидная заявка на вход в основной чат</b>\n\nПользователь: <code>${from.id}</code> ${escapeHtml(from.username ? `@${from.username}` : "no_username")}\nПричины: ${escapeHtml(reasons.join("; "))}`, { parse_mode: "HTML" });
        if (this.getConfig().autoDeclineInvalidJoinRequests) {
            await this.declineTelegramJoinRequest(from.id);
            this.repos.setInviteLinkStatus(invite.id, "revoked");
            await safeRevokeInviteLink(this.bot, this.getConfig().mainChatId, invite.invite_link);
            await this.releaseInvalidReservation(reservationId ?? undefined);
        }
    }
    // Владелец пришёл по ссылке, которую не удалось занять (consume не выиграл).
    // pending/used — это дубликат/повторный заход после уже принятой заявки:
    // молча игнорируем, чтобы не отклонить живую заявку. revoked/expired — ссылка
    // мертва: сообщаем владельцу, что нужно подать заявку заново, и мягко отклоняем.
    async handleNonActiveOwnerRequest(inviteId, from) {
        const current = this.repos.getInviteLinkById(inviteId);
        if (!current)
            return;
        if (current.status === "pending" || current.status === "used") {
            logger.debug({ inviteId, userId: from.id, status: current.status }, "duplicate join request ignored");
            return;
        }
        if (this.getConfig().autoDeclineInvalidJoinRequests)
            await this.declineTelegramJoinRequest(from.id);
        await safeSendMessage(this.bot, from.id, "Твоя персональная ссылка больше недействительна (отозвана или истёк срок). Подай новую анкету через меню бота — после одобрения придёт свежая ссылка.");
        await safeSendMessage(this.bot, this.getConfig().adminChatId, `${pe(premiumEmoji.notification, "⚠")} <b>Заход по недействительной ссылке</b>\n\nВладелец: <code>${from.id}</code> ${escapeHtml(from.username ? `@${from.username}` : "no_username")}\nСтатус ссылки: ${inviteLinkStatusLabel(current.status)}. Пользователю предложено подать заявку заново.`, { parse_mode: "HTML" });
        logger.info({ inviteId, userId: from.id, status: current.status }, "owner used stale invite link");
    }
    async handleUnknownRequest(userId, username, reason) {
        await safeSendMessage(this.bot, this.getConfig().adminChatId, `${pe(premiumEmoji.cross, "❌")} <b>Неизвестная заявка на вход</b>\n\nПользователь: <code>${userId}</code> ${escapeHtml(username ? `@${username}` : "no_username")}\nПричина: ${escapeHtml(reason)}`, { parse_mode: "HTML" });
        if (this.getConfig().autoDeclineInvalidJoinRequests)
            await this.declineTelegramJoinRequest(userId);
    }
    async releaseInvalidReservation(reservationId) {
        if (!reservationId)
            return;
        const reservation = this.repos.getReservationById(reservationId);
        if (!reservation || reservation.status !== "approved")
            return;
        this.repos.updateReservationStatus(reservation.id, "expired", null, "Персональная ссылка отозвана");
        if (reservation.reservation_kind === "waitlist")
            await this.forms.checkWaitlistQueue();
    }
    // Владелец слил свою персональную ссылку постороннему — ограничиваем его
    // от новых анкет и броней, как при авто-бане по лимиту входов (joinLimit.ts).
    async banLeakedLinkOwner(ownerUserId) {
        const owner = this.repos.getUserById(ownerUserId);
        if (!owner || owner.is_banned)
            return;
        this.repos.setUserBanned(owner.telegram_id, true, "link_leak");
        this.repos.logAdminAction({
            adminId: 0,
            action: "user_autobanned_link_leak",
            targetUserId: owner.telegram_id,
            details: "personal invite link used by another user",
        });
        logger.info({ telegramId: owner.telegram_id }, "user auto-banned after leaking personal invite link");
        await safeSendMessage(this.bot, this.getConfig().adminChatId, `${pe(premiumEmoji.cross, "❌")} <b>Слив персональной ссылки</b>\nПользователь <code>${owner.telegram_id}</code> передал свою личную ссылку другому человеку и больше не может подавать анкеты и брони.\nСнять ограничение: <code>/unban ${owner.telegram_id}</code>`, { parse_mode: "HTML" });
    }
    async declineTelegramJoinRequest(userId) {
        try {
            await this.bot.telegram.declineChatJoinRequest(this.getConfig().mainChatId, userId);
        }
        catch (error) {
            logger.warn({ error, userId }, "failed to decline invalid join request");
        }
    }
    async handleChatMember(ctx) {
        const chatMember = ctx.chatMember;
        if (!chatMember || chatMember.chat.id !== this.getConfig().mainChatId)
            return;
        const oldStatus = chatMember.old_chat_member.status;
        const newStatus = chatMember.new_chat_member.status;
        const memberStatuses = new Set(["member", "administrator", "creator"]);
        if (memberStatuses.has(oldStatus) || !memberStatuses.has(newStatus))
            return;
        const inviteUrl = chatMember.invite_link?.invite_link;
        if (!inviteUrl)
            return;
        const invite = this.repos.getInviteLinkByUrl(inviteUrl);
        if (!invite || !["active", "pending"].includes(invite.status))
            return;
        const joinedTelegramId = chatMember.new_chat_member.user.id;
        const joinedUser = this.repos.getUserById(invite.user_id);
        if (!joinedUser || joinedUser.telegram_id !== joinedTelegramId) {
            this.repos.setInviteLinkStatus(invite.id, "revoked");
            await safeRevokeInviteLink(this.bot, this.getConfig().mainChatId, invite.invite_link);
            await safeSendMessage(this.bot, this.getConfig().adminChatId, `${pe(premiumEmoji.cross, "❌")} <b>Нарушена персональность ссылки</b>\nСсылка пользователя <code>${joinedUser?.telegram_id ?? "unknown"}</code> была использована участником <code>${joinedTelegramId}</code>. Проверьте участника вручную.`, { parse_mode: "HTML" });
            await this.releaseInvalidReservation(invite.reservation_id ?? undefined);
            await this.banLeakedLinkOwner(invite.user_id);
            return;
        }
        const app = invite.application_id ? this.repos.getApplicationById(invite.application_id) : undefined;
        const reservation = invite.reservation_id ? this.repos.getReservationById(invite.reservation_id) : undefined;
        this.repos.setInviteLinkStatus(invite.id, "used");
        this.repos.markJoinRequestApprovedByInviteLinkId(invite.id);
        if (app)
            this.repos.updateApplicationStatus(app.id, "joined", app.reviewed_by_admin_id);
        if (reservation)
            this.repos.updateReservationStatus(reservation.id, "used", reservation.reviewed_by_admin_id);
        await safeRevokeInviteLink(this.bot, this.getConfig().mainChatId, invite.invite_link);
        await enforceJoinLimit(this.bot, this.repos, this.getConfig(), joinedUser);
        if (reservation?.reservation_kind === "waitlist")
            await this.forms.checkWaitlistQueue();
    }
}
