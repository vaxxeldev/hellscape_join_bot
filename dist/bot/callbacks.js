import { adminDisplay, isAdmin } from "../services/admin.js";
import { safeAnswerCallback, safeEditMessageText, safeSendMessage, withoutLinkPreview } from "../services/telegram.js";
import { logger } from "../utils/logger.js";
import { escapeHtml, mentionUser, normalizeCodeWord, usernameOrDash } from "../utils/text.js";
import { addHours, formatDate, toUnixSeconds } from "../utils/time.js";
import { adminApplicationKeyboard, adminReservationKeyboard, applicationRejectReasonsKeyboard, contactUserKeyboard, missingSubscriptionsKeyboard, reservationRejectReasonsKeyboard, } from "./keyboards.js";
import { applicationCard, joinRequestCard, missingSubscriptionsMessage, profileText, reservationCard, subscriptionsConfirmedMessage, } from "./messages.js";
import { pe, premiumEmoji } from "./premiumEmoji.js";
import { applicationStatusLabel } from "./statusLabels.js";
import { applicationRejectReasons, callbackText, commonText, reservationRejectReasons } from "./texts.js";
export class CallbackHandlers {
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
        this.bot.action("u:app", async (ctx) => {
            await safeAnswerCallback(ctx);
            await this.startApplicationFromCallback(ctx);
        });
        this.bot.action("u:res", async (ctx) => {
            await safeAnswerCallback(ctx);
            await this.startReservationFromCallback(ctx);
        });
        this.bot.action("u:waitlist", async (ctx) => {
            await safeAnswerCallback(ctx);
            await this.forms.startWaitlistReservation(ctx);
        });
        this.bot.action("u:help", async (ctx) => {
            await safeAnswerCallback(ctx, callbackText.useHelpOrMenu);
        });
        this.bot.action("u:check", async (ctx) => {
            await safeAnswerCallback(ctx);
            await this.retryPendingSubscriptionFlow(ctx);
        });
        this.bot.action("form:confirm_username", async (ctx) => {
            const handled = await this.forms.confirmProfileUsername(ctx);
            if (!handled)
                await safeAnswerCallback(ctx, callbackText.noActiveUsernameStep, true);
        });
        this.bot.action("form:cancel", async (ctx) => {
            await safeAnswerCallback(ctx);
            await this.forms.cancel(ctx);
        });
        this.bot.action("appeal:ban", async (ctx) => this.appealBan(ctx));
        this.bot.action(/^app:a:(\d+)$/, async (ctx) => this.approveApplication(ctx, Number(ctx.match[1])));
        this.bot.action(/^app:r:(\d+)$/, async (ctx) => this.showApplicationRejectReasons(ctx, Number(ctx.match[1])));
        this.bot.action(/^app:rr:(\d+):([a-z]+)$/, async (ctx) => this.rejectApplicationReason(ctx, Number(ctx.match[1]), ctx.match[2]));
        this.bot.action(/^app:s:(\d+)$/, async (ctx) => this.recheckApplication(ctx, Number(ctx.match[1])));
        this.bot.action(/^app:p:(\d+)$/, async (ctx) => this.showApplicationProfile(ctx, Number(ctx.match[1])));
        this.bot.action(/^res:a:(\d+)$/, async (ctx) => this.approveReservation(ctx, Number(ctx.match[1])));
        this.bot.action(/^res:r:(\d+)$/, async (ctx) => this.showReservationRejectReasons(ctx, Number(ctx.match[1])));
        this.bot.action(/^res:rr:(\d+):([a-z]+)$/, async (ctx) => this.rejectReservationReason(ctx, Number(ctx.match[1]), ctx.match[2]));
        this.bot.action(/^res:s:(\d+)$/, async (ctx) => this.recheckReservation(ctx, Number(ctx.match[1])));
        this.bot.action(/^res:p:(\d+)$/, async (ctx) => this.showReservationProfile(ctx, Number(ctx.match[1])));
        this.bot.action(/^res:due:a:(\d+)$/, async (ctx) => this.confirmReservationActual(ctx, Number(ctx.match[1])));
        this.bot.action(/^res:due:n:(\d+)$/, async (ctx) => this.cancelReservationAsOutdated(ctx, Number(ctx.match[1])));
        this.bot.action(/^res:due:e:(\d+)$/, async (ctx) => this.askReservationExtensionDate(ctx, Number(ctx.match[1])));
    }
    async handleRejectReasonText(ctx, text) {
        if (!ctx.from)
            return false;
        const state = this.repos.getState(ctx.from.id);
        if (!state)
            return false;
        const data = JSON.parse(state.data);
        if (state.flow === "reject_application") {
            await this.rejectApplication(ctx, data.id, text.trim() || commonText.otherReason, data.messageId);
            this.repos.clearState(ctx.from.id);
            return true;
        }
        if (state.flow === "reject_reservation") {
            await this.rejectReservation(ctx, data.id, text.trim() || commonText.otherReason, data.messageId);
            this.repos.clearState(ctx.from.id);
            return true;
        }
        return false;
    }
    async startApplicationFromCallback(ctx) {
        await this.forms.startApplication(ctx);
    }
    async startReservationFromCallback(ctx) {
        await this.forms.startReservation(ctx);
    }
    async retryPendingSubscriptionFlow(ctx) {
        if (!ctx.from)
            return;
        const state = this.repos.getState(ctx.from.id);
        if (state?.flow === "application" && state.step === "await_subscription") {
            const check = await this.subscriptions.check(ctx.from.id);
            if (!check.life || !check.info) {
                await safeEditMessageText(ctx, missingSubscriptionsMessage(check), {
                    parse_mode: "HTML",
                    ...missingSubscriptionsKeyboard(this.getConfig(), check),
                });
                return;
            }
            await safeEditMessageText(ctx, subscriptionsConfirmedMessage(), {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [] },
            });
            await this.startApplicationFromCallback(ctx);
            return;
        }
        if (state?.flow === "reservation" && state.step === "await_subscription") {
            const check = await this.subscriptions.check(ctx.from.id);
            if (!check.life || !check.info) {
                await safeEditMessageText(ctx, missingSubscriptionsMessage(check), {
                    parse_mode: "HTML",
                    ...missingSubscriptionsKeyboard(this.getConfig(), check),
                });
                return;
            }
            await safeEditMessageText(ctx, subscriptionsConfirmedMessage(), {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [] },
            });
            await this.startReservationFromCallback(ctx);
            return;
        }
        if (state?.flow === "waitlist_reservation" && state.step === "await_subscription") {
            const check = await this.subscriptions.check(ctx.from.id);
            if (!check.life || !check.info) {
                await safeEditMessageText(ctx, missingSubscriptionsMessage(check), {
                    parse_mode: "HTML",
                    ...missingSubscriptionsKeyboard(this.getConfig(), check),
                });
                return;
            }
            await safeEditMessageText(ctx, subscriptionsConfirmedMessage(), {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [] },
            });
            await this.forms.startWaitlistReservation(ctx);
            return;
        }
        await ctx.reply(callbackText.subscriptionsCheckedChooseMenu);
    }
    async approveApplication(ctx, applicationId) {
        if (!(await this.ensureAdmin(ctx)))
            return;
        const app = this.repos.getApplicationById(applicationId);
        if (!app)
            return safeAnswerCallback(ctx, commonText.applicationNotFound, true);
        if (app.status !== "pending")
            return safeAnswerCallback(ctx, `Анкета уже обработана: ${applicationStatusLabel(app.status, app.reject_reason)}`, true);
        const user = this.repos.getUserById(app.user_id);
        if (!user)
            return safeAnswerCallback(ctx, commonText.userNotFound, true);
        const check = await this.subscriptions.check(user.telegram_id);
        this.repos.updateApplicationSubscriptionSnapshot(app.id, check.life, check.info);
        const codeWordValid = normalizeCodeWord(app.code_word_entered) === normalizeCodeWord(this.getConfig().codeWord);
        const reasons = [];
        if (!check.life)
            reasons.push("нет подписки на лайф-канал");
        if (!check.info)
            reasons.push("нет подписки на инфо-канал");
        if (!codeWordValid)
            reasons.push("неверное кодовое слово");
        if (reasons.length) {
            await safeSendMessage(this.bot, this.getConfig().adminChatId, `Анкета #${app.id} не одобрена: ${reasons.join(", ")}.`);
            return safeAnswerCallback(ctx, callbackText.approvalChecksFailed, true);
        }
        const expiresAt = addHours(new Date(), this.getConfig().inviteExpireHours);
        let inviteLink;
        try {
            // Telegram forbids combining creates_join_request with member_limit,
            // so one-person behavior is enforced by invite_links in SQLite.
            const invite = await this.bot.telegram.createChatInviteLink(this.getConfig().mainChatId, {
                name: `app-${app.id}-u-${user.telegram_id}`,
                expire_date: toUnixSeconds(expiresAt),
                creates_join_request: true,
            });
            inviteLink = invite.invite_link;
        }
        catch (error) {
            logger.error({ error, applicationId }, "failed to create invite link");
            await safeSendMessage(this.bot, this.getConfig().adminChatId, `Не удалось создать invite-ссылку для анкеты #${app.id}.`);
            return safeAnswerCallback(ctx, callbackText.inviteCreationError, true);
        }
        this.repos.updateApplicationStatus(app.id, "approved", ctx.from.id);
        this.repos.createInviteLink({
            applicationId: app.id,
            userId: user.id,
            inviteLink,
            expiresAt: expiresAt.toISOString(),
        });
        this.repos.logAdminAction({
            adminId: ctx.from.id,
            action: "application_approved",
            targetUserId: user.telegram_id,
            applicationId: app.id,
        });
        await this.notifyUser(user.telegram_id, `Твоя анкета одобрена! Вот личная ссылка для подачи заявки в основной чат.\n\n${inviteLink}\n\nСсылка временная и работает только для тебя.`, `одобрение анкеты #${app.id}`);
        await safeSendMessage(this.bot, this.getConfig().adminChatId, `${pe(premiumEmoji.check, "✅")} <b>Анкета #${app.id} одобрена</b>\nАдминистратор: ${this.adminLabel(ctx)}\nПользователь: <code>${user.telegram_id}</code>\nЛичная ссылка отправлена пользователю.`, { parse_mode: "HTML" });
        const updated = this.repos.getApplicationById(app.id);
        const previousCount = Math.max(0, this.repos.countApplicationsByUserId(user.id) - 1);
        await safeEditMessageText(ctx, `${applicationCard(updated, user, check, previousCount)}\n\n<b>Решение:</b> ${pe(premiumEmoji.check, "✅")} одобрил ${this.adminLabel(ctx)}`, withoutLinkPreview({ parse_mode: "HTML" }));
        await safeAnswerCallback(ctx, callbackText.applicationApproved);
    }
    async showApplicationRejectReasons(ctx, applicationId) {
        if (!(await this.ensureAdmin(ctx)))
            return;
        const app = this.repos.getApplicationById(applicationId);
        if (!app)
            return safeAnswerCallback(ctx, commonText.applicationNotFound, true);
        if (app.status !== "pending")
            return safeAnswerCallback(ctx, `Анкета уже обработана: ${applicationStatusLabel(app.status, app.reject_reason)}`, true);
        const user = this.repos.getUserById(app.user_id);
        if (!user)
            return safeAnswerCallback(ctx, commonText.userNotFound, true);
        const check = { life: Boolean(app.life_channel_subscribed), info: Boolean(app.info_channel_subscribed) };
        const previousCount = Math.max(0, this.repos.countApplicationsByUserId(user.id) - 1);
        await safeEditMessageText(ctx, `${applicationCard(app, user, check, previousCount)}\n\n${callbackText.chooseRejectReason}`, withoutLinkPreview({ parse_mode: "HTML", ...applicationRejectReasonsKeyboard(applicationId) }));
        await safeAnswerCallback(ctx);
    }
    async rejectApplicationReason(ctx, applicationId, code) {
        if (!(await this.ensureAdmin(ctx)))
            return;
        if (code === "other") {
            this.repos.setState(ctx.from.id, "reject_application", "reason", {
                id: applicationId,
                messageId: this.callbackMessageId(ctx),
            });
            await ctx.reply(`Напишите причину отказа для анкеты #${applicationId}.`);
            return safeAnswerCallback(ctx);
        }
        await this.rejectApplication(ctx, applicationId, applicationRejectReasons[code] ?? commonText.otherReason);
    }
    async rejectApplication(ctx, applicationId, reason, messageId) {
        if (!(await this.ensureAdmin(ctx)))
            return;
        const app = this.repos.getApplicationById(applicationId);
        if (!app)
            return safeAnswerCallback(ctx, commonText.applicationNotFound, true);
        if (app.status !== "pending")
            return safeAnswerCallback(ctx, `Анкета уже обработана: ${applicationStatusLabel(app.status, app.reject_reason)}`, true);
        const user = this.repos.getUserById(app.user_id);
        if (!user)
            return safeAnswerCallback(ctx, commonText.userNotFound, true);
        this.repos.updateApplicationStatus(app.id, "rejected", ctx.from.id, reason);
        this.repos.logAdminAction({
            adminId: ctx.from.id,
            action: "application_rejected",
            targetUserId: user.telegram_id,
            applicationId: app.id,
            details: reason,
        });
        await this.notifyUser(user.telegram_id, `К сожалению, анкету отклонили.\nПричина: ${reason}`, `отказ по анкете #${app.id}`);
        await safeSendMessage(this.bot, this.getConfig().adminChatId, `${pe(premiumEmoji.cross, "❌")} <b>Анкета #${app.id} отклонена</b>\nАдминистратор: ${this.adminLabel(ctx)}\nПричина: ${escapeHtml(reason)}`, { parse_mode: "HTML" });
        const check = { life: Boolean(app.life_channel_subscribed), info: Boolean(app.info_channel_subscribed) };
        const updated = this.repos.getApplicationById(app.id);
        const previousCount = Math.max(0, this.repos.countApplicationsByUserId(user.id) - 1);
        await this.editDecisionMessage(ctx, messageId, `${applicationCard(updated, user, check, previousCount)}\n\n<b>Решение:</b> ${pe(premiumEmoji.cross, "❌")} отказал ${this.adminLabel(ctx)}\n<b>Причина:</b> ${escapeHtml(reason)}`, withoutLinkPreview({ parse_mode: "HTML" }));
        await safeAnswerCallback(ctx, callbackText.applicationRejected);
    }
    async recheckApplication(ctx, applicationId) {
        if (!(await this.ensureAdmin(ctx)))
            return;
        const app = this.repos.getApplicationById(applicationId);
        if (!app)
            return safeAnswerCallback(ctx, commonText.applicationNotFound, true);
        const user = this.repos.getUserById(app.user_id);
        if (!user)
            return safeAnswerCallback(ctx, commonText.userNotFound, true);
        const check = await this.subscriptions.check(user.telegram_id);
        this.repos.updateApplicationSubscriptionSnapshot(app.id, check.life, check.info);
        const updated = this.repos.getApplicationById(app.id);
        const previousCount = Math.max(0, this.repos.countApplicationsByUserId(user.id) - 1);
        await safeEditMessageText(ctx, applicationCard(updated, user, check, previousCount), {
            ...withoutLinkPreview(),
            parse_mode: "HTML",
            ...adminApplicationKeyboard(app.id),
        });
        await safeAnswerCallback(ctx, commonText.subscriptionRechecked);
    }
    async showApplicationProfile(ctx, applicationId) {
        if (!(await this.ensureAdmin(ctx)))
            return;
        const app = this.repos.getApplicationById(applicationId);
        const user = app ? this.repos.getUserById(app.user_id) : undefined;
        if (!user)
            return safeAnswerCallback(ctx, commonText.userNotFound, true);
        await ctx.reply(profileText(user), { parse_mode: "HTML" });
        await safeAnswerCallback(ctx);
    }
    async approveReservation(ctx, reservationId) {
        if (!(await this.ensureAdmin(ctx)))
            return;
        const reservation = this.repos.getReservationById(reservationId);
        if (!reservation)
            return safeAnswerCallback(ctx, commonText.reservationNotFound, true);
        if (reservation.status !== "pending")
            return safeAnswerCallback(ctx, commonText.alreadyReviewed, true);
        const user = this.repos.getUserById(reservation.user_id);
        if (!user)
            return safeAnswerCallback(ctx, commonText.userNotFound, true);
        if (reservation.reservation_kind === "waitlist") {
            this.repos.updateReservationStatus(reservation.id, "approved", ctx.from.id);
            this.repos.logAdminAction({
                adminId: ctx.from.id,
                action: "waitlist_reservation_approved",
                targetUserId: user.telegram_id,
                details: reservation.role_name,
            });
            await this.notifyUser(user.telegram_id, `Ваша бронь роли «${reservation.role_name}» одобрена и поставлена в очередь закрытого набора. Когда в основном чате появится место, бот уточнит, актуальна ли бронь.`, `одобрение waitlist-брони #${reservation.id}`);
            await safeSendMessage(this.bot, this.getConfig().adminChatId, `${pe(premiumEmoji.check, "✅")} <b>Бронь #${reservation.id} одобрена</b>

╭ <b>Очередь закрытого набора</b>
├ Роль: <b>${escapeHtml(reservation.role_name)}</b>
╰ Срок: до появления места в основном чате

╭ <b>Решение</b>
├ Администратор: ${this.adminLabel(ctx)}
╰ Пользователь: <code>${user.telegram_id}</code>`, { parse_mode: "HTML" });
            const updated = this.repos.getReservationById(reservation.id);
            const check = await this.subscriptions.check(user.telegram_id);
            await safeEditMessageText(ctx, `${reservationCard(updated, user, check)}\n\n<b>Решение:</b> ${pe(premiumEmoji.check, "✅")} бронь закрытого набора одобрил ${this.adminLabel(ctx)}`, withoutLinkPreview({ parse_mode: "HTML" }));
            await safeAnswerCallback(ctx, callbackText.reservationApproved);
            await this.forms.checkWaitlistQueue();
            return;
        }
        this.repos.updateReservationStatus(reservation.id, "approved", ctx.from.id);
        this.repos.logAdminAction({
            adminId: ctx.from.id,
            action: "reservation_approved",
            targetUserId: user.telegram_id,
            details: `${reservation.role_name} until ${reservation.reserve_until}`,
        });
        await this.notifyUser(user.telegram_id, `Ваша бронь роли «${reservation.role_name}» одобрена до ${formatDate(reservation.reserve_until)}. В день брони бот уточнит, актуальна ли она, и при подтверждении отправит ссылку на основной чат.`, `одобрение брони #${reservation.id}`);
        await safeSendMessage(this.bot, this.getConfig().adminChatId, `${pe(premiumEmoji.check, "✅")} <b>Бронь #${reservation.id} одобрена</b>

╭ <b>Роль</b>
├ ${escapeHtml(reservation.role_name)}
╰ До: ${escapeHtml(formatDate(reservation.reserve_until))}

╭ <b>Решение</b>
├ Администратор: ${this.adminLabel(ctx)}
╰ Пользователь: <code>${user.telegram_id}</code>`, { parse_mode: "HTML" });
        const updated = this.repos.getReservationById(reservation.id);
        const check = await this.subscriptions.check(user.telegram_id);
        await safeEditMessageText(ctx, `${reservationCard(updated, user, check)}\n\n<b>Решение:</b> ${pe(premiumEmoji.check, "✅")} бронь одобрил ${this.adminLabel(ctx)}`, withoutLinkPreview({ parse_mode: "HTML" }));
        await safeAnswerCallback(ctx, callbackText.reservationApproved);
    }
    async showReservationRejectReasons(ctx, reservationId) {
        if (!(await this.ensureAdmin(ctx)))
            return;
        const reservation = this.repos.getReservationById(reservationId);
        if (!reservation)
            return safeAnswerCallback(ctx, commonText.reservationNotFound, true);
        if (reservation.status !== "pending")
            return safeAnswerCallback(ctx, commonText.alreadyReviewed, true);
        const user = this.repos.getUserById(reservation.user_id);
        if (!user)
            return safeAnswerCallback(ctx, commonText.userNotFound, true);
        const check = await this.subscriptions.check(user.telegram_id);
        await safeEditMessageText(ctx, `${reservationCard(reservation, user, check)}\n\n${callbackText.chooseRejectReason}`, withoutLinkPreview({ parse_mode: "HTML", ...reservationRejectReasonsKeyboard(reservationId) }));
        await safeAnswerCallback(ctx);
    }
    async rejectReservationReason(ctx, reservationId, code) {
        if (!(await this.ensureAdmin(ctx)))
            return;
        if (code === "other") {
            this.repos.setState(ctx.from.id, "reject_reservation", "reason", {
                id: reservationId,
                messageId: this.callbackMessageId(ctx),
            });
            await ctx.reply(`Напишите причину отказа для брони #${reservationId}.`);
            return safeAnswerCallback(ctx);
        }
        await this.rejectReservation(ctx, reservationId, reservationRejectReasons[code] ?? commonText.otherReason);
    }
    async rejectReservation(ctx, reservationId, reason, messageId) {
        if (!(await this.ensureAdmin(ctx)))
            return;
        const reservation = this.repos.getReservationById(reservationId);
        if (!reservation)
            return safeAnswerCallback(ctx, commonText.reservationNotFound, true);
        if (reservation.status !== "pending")
            return safeAnswerCallback(ctx, commonText.alreadyReviewed, true);
        const user = this.repos.getUserById(reservation.user_id);
        if (!user)
            return safeAnswerCallback(ctx, commonText.userNotFound, true);
        this.repos.updateReservationStatus(reservation.id, "rejected", ctx.from.id, reason);
        this.repos.logAdminAction({
            adminId: ctx.from.id,
            action: "reservation_rejected",
            targetUserId: user.telegram_id,
            details: reason,
        });
        await this.notifyUser(user.telegram_id, `К сожалению, бронь роли отклонили.\nПричина: ${reason}`, `отказ по брони #${reservation.id}`);
        await safeSendMessage(this.bot, this.getConfig().adminChatId, `${pe(premiumEmoji.cross, "❌")} <b>Бронь #${reservation.id} отклонена</b>\nАдминистратор: ${this.adminLabel(ctx)}\nПричина: ${escapeHtml(reason)}`, { parse_mode: "HTML" });
        const updated = this.repos.getReservationById(reservation.id);
        const check = await this.subscriptions.check(user.telegram_id);
        await this.editDecisionMessage(ctx, messageId, `${reservationCard(updated, user, check)}\n\n<b>Решение:</b> ${pe(premiumEmoji.cross, "❌")} бронь отклонил ${this.adminLabel(ctx)}\n<b>Причина:</b> ${escapeHtml(reason)}`, withoutLinkPreview({ parse_mode: "HTML" }));
        await safeAnswerCallback(ctx, callbackText.reservationRejected);
    }
    async recheckReservation(ctx, reservationId) {
        if (!(await this.ensureAdmin(ctx)))
            return;
        const reservation = this.repos.getReservationById(reservationId);
        if (!reservation)
            return safeAnswerCallback(ctx, commonText.reservationNotFound, true);
        const user = this.repos.getUserById(reservation.user_id);
        if (!user)
            return safeAnswerCallback(ctx, commonText.userNotFound, true);
        const check = await this.subscriptions.check(user.telegram_id);
        await safeEditMessageText(ctx, reservationCard(reservation, user, check), {
            ...withoutLinkPreview(),
            parse_mode: "HTML",
            ...adminReservationKeyboard(reservation.id),
        });
        await safeAnswerCallback(ctx, commonText.subscriptionRechecked);
    }
    async showReservationProfile(ctx, reservationId) {
        if (!(await this.ensureAdmin(ctx)))
            return;
        const reservation = this.repos.getReservationById(reservationId);
        const user = reservation ? this.repos.getUserById(reservation.user_id) : undefined;
        if (!user)
            return safeAnswerCallback(ctx, commonText.userNotFound, true);
        await ctx.reply(profileText(user), { parse_mode: "HTML" });
        await safeAnswerCallback(ctx);
    }
    async confirmReservationActual(ctx, reservationId) {
        const data = this.getOwnedReservation(ctx, reservationId);
        if (!data)
            return safeAnswerCallback(ctx, callbackText.reservationUnavailable, true);
        const { reservation, user } = data;
        const isWaitlist = reservation.reservation_kind === "waitlist";
        if (reservation.status !== "approved")
            return safeAnswerCallback(ctx, callbackText.reservationInactive, true);
        if (isWaitlist) {
            const capacity = await this.forms.mainChatCapacity();
            if (capacity.isFull) {
                this.repos.resetWaitlistNotification(reservation.id);
                await safeEditMessageText(ctx, "Место уже заняли, поэтому бронь вернулась в очередь. Бот снова напишет, когда появится место.", {
                    reply_markup: { inline_keyboard: [] },
                });
                await safeAnswerCallback(ctx, callbackText.waitlistReturned);
                return;
            }
        }
        const expiresAt = addHours(new Date(), this.getConfig().inviteExpireHours);
        let inviteLink;
        try {
            const invite = await this.bot.telegram.createChatInviteLink(this.getConfig().mainChatId, {
                name: `res-${reservation.id}-u-${user.telegram_id}`,
                expire_date: toUnixSeconds(expiresAt),
                member_limit: 1,
            });
            inviteLink = invite.invite_link;
        }
        catch (error) {
            logger.error({ error, reservationId }, "failed to create reservation invite link");
            return safeAnswerCallback(ctx, callbackText.linkCreationFailed, true);
        }
        this.repos.updateReservationStatus(reservation.id, "used", null);
        await safeEditMessageText(ctx, `Бронь роли «${reservation.role_name}» подтверждена. Ссылка отправлена ниже.`, {
            reply_markup: { inline_keyboard: [] },
        });
        await ctx.reply(`Вот личная ссылка для подачи заявки в основной чат по брони роли «${reservation.role_name}»:\n\n${inviteLink}\n\nСсылка временная и работает только для вас.`);
        await safeSendMessage(this.bot, this.getConfig().adminChatId, `Пользователь ${user.telegram_id} подтвердил актуальность брони #${reservation.id}: ${reservation.role_name}. Ссылка отправлена.`);
        await safeAnswerCallback(ctx, callbackText.linkSent);
    }
    async cancelReservationAsOutdated(ctx, reservationId) {
        const data = this.getOwnedReservation(ctx, reservationId);
        if (!data)
            return safeAnswerCallback(ctx, callbackText.reservationUnavailable, true);
        const { reservation, user } = data;
        this.repos.deleteReservation(reservation.id);
        await safeEditMessageText(ctx, `Бронь роли «${reservation.role_name}» удалена. Если понадобится, вы сможете создать новую бронь через меню.`, { reply_markup: { inline_keyboard: [] } });
        await safeSendMessage(this.bot, this.getConfig().adminChatId, `Пользователь ${user.telegram_id} отменил бронь #${reservation.id}: ${reservation.role_name}. Бронь удалена.`);
        if (reservation.reservation_kind === "waitlist")
            await this.forms.checkWaitlistQueue();
        await safeAnswerCallback(ctx, callbackText.reservationDeleted);
    }
    async askReservationExtensionDate(ctx, reservationId) {
        const data = this.getOwnedReservation(ctx, reservationId);
        if (!data)
            return safeAnswerCallback(ctx, callbackText.reservationUnavailable, true);
        const { reservation } = data;
        if (reservation.reservation_kind === "waitlist") {
            await safeAnswerCallback(ctx, callbackText.datedReservationCannotExtend, true);
            return;
        }
        this.repos.setState(ctx.from.id, "extend_reservation", "date", { id: reservation.id });
        await safeEditMessageText(ctx, `Бронь роли «${reservation.role_name}» будет продлена. Напишите новую дату в формате ДД.ММ.ГГГГ.`, {
            reply_markup: { inline_keyboard: [] },
        });
        await safeAnswerCallback(ctx);
    }
    getOwnedReservation(ctx, reservationId) {
        if (!ctx.from)
            return null;
        const reservation = this.repos.getReservationById(reservationId);
        const user = reservation ? this.repos.getUserById(reservation.user_id) : undefined;
        if (!reservation || !user || user.telegram_id !== ctx.from.id)
            return null;
        return { reservation, user };
    }
    async appealBan(ctx) {
        if (!ctx.from)
            return;
        const user = this.repos.upsertUser({
            telegramId: ctx.from.id,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
        });
        // Без username администрации не за что зацепиться, чтобы связаться с юзером.
        // Просим установить его и нажать «Оспорить» снова (кнопку при этом не убираем).
        if (!user.username) {
            await safeAnswerCallback(ctx, callbackText.usernameRequired, true);
            await ctx.reply("Чтобы администрация могла связаться с вами по обращению, установите @username в настройках Telegram (Настройки → Имя пользователя), а затем нажмите «Оспорить» ещё раз.");
            return;
        }
        await safeSendMessage(this.bot, this.getConfig().adminChatId, `${pe(premiumEmoji.notification, "⚠")} <b>Обжалование блокировки</b>\n\nПользователь ${mentionUser(user)} (<code>${user.telegram_id}</code>, ${escapeHtml(usernameOrDash(user.username))}) хочет оспорить блокировку в боте и просит администрацию связаться с ним.`, withoutLinkPreview({ parse_mode: "HTML", ...(contactUserKeyboard(user) ?? {}) }));
        await safeEditMessageText(ctx, "Обращение отправлено администрации. Ожидайте, с вами свяжутся.");
        await safeAnswerCallback(ctx, callbackText.appealSent);
    }
    async ensureAdmin(ctx) {
        if (isAdmin(this.getConfig(), ctx.from?.id))
            return true;
        await safeAnswerCallback(ctx, commonText.adminOnlyButton, true);
        return false;
    }
    adminLabel(ctx) {
        return ctx.from ? adminDisplay(this.getConfig(), ctx.from) : "администратор";
    }
    callbackMessageId(ctx) {
        const callbackQuery = ctx.callbackQuery;
        if (callbackQuery && "message" in callbackQuery && callbackQuery.message) {
            return callbackQuery.message.message_id;
        }
        return undefined;
    }
    async editDecisionMessage(ctx, messageId, text, extra) {
        if (messageId) {
            try {
                await this.bot.telegram.editMessageText(this.getConfig().adminChatId, messageId, undefined, text, extra);
                return;
            }
            catch (error) {
                logger.warn({ error, messageId }, "failed to edit stored admin message");
            }
        }
        await safeEditMessageText(ctx, text, extra);
    }
    async notifyUser(telegramId, text, context) {
        const sent = await safeSendMessage(this.bot, telegramId, text);
        if (!sent) {
            await safeSendMessage(this.bot, this.getConfig().adminChatId, `Бот не смог написать пользователю ${telegramId} в личку: ${context}.`);
        }
    }
}
export async function sendJoinRequestForAdmin(bot, repos, config, requestId, subscriptions) {
    const request = repos.getJoinRequestById(requestId);
    if (!request?.user_id || !request.invite_link_id || !request.application_id)
        return;
    const user = repos.getUserById(request.user_id);
    const invite = repos.getInviteLinkById(request.invite_link_id);
    const app = repos.getApplicationById(request.application_id);
    if (!user || !invite || !app)
        return;
    const check = await subscriptions.check(user.telegram_id);
    await safeSendMessage(bot, config.adminChatId, joinRequestCard({ request, app, user, invite, subscriptions: check }), withoutLinkPreview({ parse_mode: "HTML" }));
}
