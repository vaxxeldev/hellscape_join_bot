import { enforceJoinLimit } from "../services/joinLimit.js";
import { safeRevokeInviteLink, safeSendMessage } from "../services/telegram.js";
import { logger } from "../utils/logger.js";
import { escapeHtml } from "../utils/text.js";
import { isPastIso } from "../utils/time.js";
import { pe, premiumEmoji } from "./premiumEmoji.js";
import { applicationStatusLabel, inviteLinkStatusLabel } from "./statusLabels.js";
export class JoinRequestHandlers {
    bot;
    repos;
    subscriptions;
    getConfig;
    constructor(bot, repos, subscriptions, getConfig) {
        this.bot = bot;
        this.repos = repos;
        this.subscriptions = subscriptions;
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
        if (!inviteUrl)
            return;
        const invite = this.repos.getInviteLinkByUrl(inviteUrl);
        if (!invite)
            return;
        const user = this.repos.upsertUser({
            telegramId: from.id,
            username: from.username,
            firstName: from.first_name,
            lastName: from.last_name,
        });
        const reasons = [];
        if (user.is_banned)
            reasons.push("пользователь заблокирован в базе бота");
        const app = this.repos.getApplicationById(invite.application_id);
        if (invite.user_id !== user.id)
            reasons.push("пользователь не является владельцем ссылки");
        if (invite.status !== "active")
            reasons.push(`статус ссылки: ${inviteLinkStatusLabel(invite.status)}`);
        if (isPastIso(invite.expires_at))
            reasons.push("срок ссылки истек");
        if (!app)
            reasons.push("связанная анкета не найдена");
        if (app && app.status !== "approved")
            reasons.push(`анкета не одобрена: ${applicationStatusLabel(app.status, app.reject_reason)}`);
        const check = await this.subscriptions.check(from.id);
        if (!check.life || !check.info)
            reasons.push("пользователь больше не подписан на оба канала");
        if (reasons.length) {
            this.repos.createJoinRequest({
                applicationId: app?.id ?? null,
                userId: user.id,
                inviteLinkId: invite.id,
                status: "rejected",
            });
            await safeSendMessage(this.bot, this.getConfig().adminChatId, `${pe(premiumEmoji.cross, "❌")} <b>Невалидная заявка на вход в основной чат</b>\n\nПользователь: <code>${from.id}</code> ${escapeHtml(from.username ? `@${from.username}` : "no_username")}\nПричины: ${escapeHtml(reasons.join("; "))}`, { parse_mode: "HTML" });
            if (this.getConfig().autoDeclineInvalidJoinRequests) {
                await this.declineTelegramJoinRequest(from.id);
                this.repos.setInviteLinkStatus(invite.id, "revoked");
                await safeRevokeInviteLink(this.bot, this.getConfig().mainChatId, invite.invite_link);
            }
            return;
        }
        this.repos.createJoinRequest({
            applicationId: app.id,
            userId: user.id,
            inviteLinkId: invite.id,
            status: "pending",
        });
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
        if (!invite || invite.status !== "active")
            return;
        const app = this.repos.getApplicationById(invite.application_id);
        this.repos.setInviteLinkStatus(invite.id, "used");
        this.repos.markJoinRequestApprovedByInviteLinkId(invite.id);
        if (app)
            this.repos.updateApplicationStatus(app.id, "joined", app.reviewed_by_admin_id);
        await safeRevokeInviteLink(this.bot, this.getConfig().mainChatId, invite.invite_link);
        const joinedUser = this.repos.getUserById(invite.user_id);
        if (joinedUser)
            await enforceJoinLimit(this.bot, this.repos, this.getConfig(), joinedUser);
    }
}
