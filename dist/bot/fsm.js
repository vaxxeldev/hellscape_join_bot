import { adminReservationKeyboard, appealBanKeyboard, applicationRoleLinksKeyboard, codeRulesKeyboard, confirmUsernameKeyboard, missingSubscriptionsKeyboard, recruitmentClosedKeyboard, reservationDueKeyboard, waitlistDueKeyboard, } from "./keyboards.js";
import { activeApplicationExistsMessage, activeReservationExistsMessage, alreadyMainChatMemberMessage, applicationCard, applicationCodeStepMessage, applicationInviteCreationFailedAdminMessage, applicationPrivateOnlyMessage, applicationRoleStepMessage, applicationSubmittedMessage, codeWordAcceptedMessage, emptyApplicationRoleMessage, emptyApplicationUsernameMessage, emptyCodeWordMessage, emptyReservationRoleMessage, emptyUsernameMessage, fillingCancelledMessage, invalidDateMessage, invalidCodeWordMessage, joinLimitBannedMessage, manualBannedMessage, missingSubscriptionsMessage, pastDateMessage, profileUsernameMissingMessage, recruitmentClosedMessage, reservationCard, reservationCodeStepMessage, reservationDateStepMessage, reservationExtendedAdminMessage, reservationExtendedMessage, reservationExtensionForbiddenMessage, reservationMissingForExtensionMessage, reservationPrivateOnlyMessage, reservationRoleStepMessage, reservationSubmittedMessage, roleValidationMessage, subscriptionsFoundMessage, tooManyApplicationsMessage, usernameStepMessage, waitlistPrivateOnlyMessage, waitlistRoleStepMessage, waitlistSubmittedMessage, } from "./messages.js";
import { isMessageNotModifiedError, safeReplyWithBanner, safeSendBanner, safeSendMessage, withoutLinkPreview } from "../services/telegram.js";
import { logger } from "../utils/logger.js";
import { escapeHtml, normalizeCodeWord } from "../utils/text.js";
import { addHours, parseUserDate, toUnixSeconds } from "../utils/time.js";
const mainChatCapacityCacheMs = 15_000;
const failedMainChatCapacityCacheMs = 3_000;
export class FormService {
    bot;
    repos;
    subscriptions;
    roles;
    getConfig;
    mainChatCapacityCache = null;
    mainChatCapacityInFlight = null;
    constructor(bot, repos, subscriptions, roles, getConfig) {
        this.bot = bot;
        this.repos = repos;
        this.subscriptions = subscriptions;
        this.roles = roles;
        this.getConfig = getConfig;
    }
    async startApplication(ctx) {
        if (!ctx.from)
            return;
        if (ctx.chat?.type !== "private") {
            await ctx.reply(applicationPrivateOnlyMessage());
            return;
        }
        const user = this.repos.upsertUser({
            telegramId: ctx.from.id,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
        });
        if (user.is_banned) {
            await this.replyBanned(ctx, user);
            return;
        }
        if (await this.blockIfAlreadyMember(ctx))
            return;
        const activeApplication = this.repos.getActiveApplicationByTelegramId(ctx.from.id);
        if (activeApplication) {
            await ctx.reply(activeApplicationExistsMessage(activeApplication.id));
            return;
        }
        if (this.repos.countApplicationsLastDay(user.id) >= this.getConfig().maxApplicationsPerDay) {
            await ctx.reply(tooManyApplicationsMessage());
            return;
        }
        const capacity = await this.mainChatCapacity();
        if (capacity.isFull) {
            await ctx.reply(recruitmentClosedMessage(capacity.count, capacity.limit), {
                parse_mode: "HTML",
                ...recruitmentClosedKeyboard(),
            });
            return;
        }
        const check = await this.subscriptions.check(ctx.from.id);
        if (!check.life || !check.info) {
            this.repos.setState(ctx.from.id, "application", "await_subscription", {});
            await ctx.reply(missingSubscriptionsMessage(check), { parse_mode: "HTML", ...missingSubscriptionsKeyboard(this.getConfig(), check) });
            return;
        }
        this.repos.setState(ctx.from.id, "application", "role", {});
        await ctx.reply(applicationRoleStepMessage(), {
            parse_mode: "HTML",
            ...applicationRoleLinksKeyboard(this.getConfig()),
        });
    }
    async startReservation(ctx) {
        if (!ctx.from)
            return;
        if (ctx.chat?.type !== "private") {
            await ctx.reply(reservationPrivateOnlyMessage());
            return;
        }
        const user = this.repos.upsertUser({
            telegramId: ctx.from.id,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
        });
        if (user.is_banned) {
            await this.replyBanned(ctx, user);
            return;
        }
        if (await this.blockIfAlreadyMember(ctx))
            return;
        const activeReservation = this.repos.getActiveReservationByTelegramId(ctx.from.id);
        if (activeReservation) {
            await ctx.reply(activeReservationExistsMessage());
            return;
        }
        const check = await this.subscriptions.check(ctx.from.id);
        if (!check.life || !check.info) {
            this.repos.setState(ctx.from.id, "reservation", "await_subscription", {});
            await ctx.reply(missingSubscriptionsMessage(check), { parse_mode: "HTML", ...missingSubscriptionsKeyboard(this.getConfig(), check) });
            return;
        }
        this.repos.setState(ctx.from.id, "reservation", "role", {});
        await ctx.reply(reservationRoleStepMessage(), {
            parse_mode: "HTML",
            ...applicationRoleLinksKeyboard(this.getConfig()),
        });
    }
    async startWaitlistReservation(ctx) {
        if (!ctx.from)
            return;
        if (ctx.chat?.type !== "private") {
            await ctx.reply(waitlistPrivateOnlyMessage());
            return;
        }
        const user = this.repos.upsertUser({
            telegramId: ctx.from.id,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
        });
        if (user.is_banned) {
            await this.replyBanned(ctx, user);
            return;
        }
        if (await this.blockIfAlreadyMember(ctx))
            return;
        const activeReservation = this.repos.getActiveReservationByTelegramId(ctx.from.id);
        if (activeReservation) {
            await ctx.reply(activeReservationExistsMessage());
            return;
        }
        const check = await this.subscriptions.check(ctx.from.id);
        if (!check.life || !check.info) {
            this.repos.setState(ctx.from.id, "waitlist_reservation", "await_subscription", {});
            await ctx.reply(missingSubscriptionsMessage(check), { parse_mode: "HTML", ...missingSubscriptionsKeyboard(this.getConfig(), check) });
            return;
        }
        this.repos.setState(ctx.from.id, "waitlist_reservation", "role", {});
        await ctx.reply(waitlistRoleStepMessage(), {
            parse_mode: "HTML",
            ...applicationRoleLinksKeyboard(this.getConfig()),
        });
    }
    async continueText(ctx, text) {
        if (!ctx.from)
            return false;
        if (ctx.chat?.type !== "private")
            return false;
        const state = this.repos.getState(ctx.from.id);
        if (!state)
            return false;
        if (state.flow === "application") {
            await this.continueApplication(ctx, state.step, JSON.parse(state.data), text);
            return true;
        }
        if (state.flow === "reservation") {
            await this.continueReservation(ctx, state.step, JSON.parse(state.data), text);
            return true;
        }
        if (state.flow === "waitlist_reservation") {
            await this.continueWaitlistReservation(ctx, state.step, JSON.parse(state.data), text);
            return true;
        }
        if (state.flow === "extend_reservation") {
            await this.continueReservationExtension(ctx, state.step, JSON.parse(state.data), text);
            return true;
        }
        return false;
    }
    async cancel(ctx) {
        if (!ctx.from)
            return;
        this.repos.clearState(ctx.from.id);
        await safeReplyWithBanner(ctx, "cancel", fillingCancelledMessage());
    }
    async confirmProfileUsername(ctx) {
        if (!ctx.from || ctx.chat?.type !== "private")
            return false;
        const state = this.repos.getState(ctx.from.id);
        if (!state || state.step !== "username")
            return false;
        const defaultUsername = ctx.from.username ? `@${ctx.from.username}` : "";
        if (!defaultUsername) {
            await ctx.answerCbQuery(profileUsernameMissingMessage(), { show_alert: true });
            return true;
        }
        const data = JSON.parse(state.data);
        if (state.flow === "application") {
            await ctx.answerCbQuery();
            await this.acceptApplicationUsername(ctx, data, defaultUsername);
            return true;
        }
        if (state.flow === "reservation") {
            await ctx.answerCbQuery();
            await this.acceptReservationUsername(ctx, data, defaultUsername);
            return true;
        }
        if (state.flow === "waitlist_reservation") {
            await ctx.answerCbQuery();
            await this.acceptWaitlistUsername(ctx, data, defaultUsername);
            return true;
        }
        return false;
    }
    async continueApplication(ctx, step, data, text) {
        const telegramId = ctx.from.id;
        const trimmed = text.trim();
        if (step === "role") {
            if (!trimmed) {
                await ctx.reply(emptyApplicationRoleMessage());
                return;
            }
            const roleCheck = await this.roles.checkRole(trimmed);
            if (!roleCheck.ok) {
                await ctx.reply(roleValidationMessage(trimmed, roleCheck.reason), {
                    parse_mode: "HTML",
                    ...applicationRoleLinksKeyboard(this.getConfig()),
                });
                return;
            }
            const defaultUsername = ctx.from?.username ? `@${ctx.from.username}` : "";
            this.repos.setState(telegramId, "application", "username", { ...data, role: roleCheck.role });
            await ctx.reply(usernameStepMessage("2/4", defaultUsername), { parse_mode: "HTML", ...(defaultUsername ? confirmUsernameKeyboard() : {}) });
            return;
        }
        if (step === "username") {
            if (!trimmed) {
                await ctx.reply(emptyApplicationUsernameMessage());
                return;
            }
            await this.acceptApplicationUsername(ctx, data, trimmed);
            return;
        }
        if (step === "code") {
            if (!trimmed) {
                await this.editCodePrompt(ctx, data, emptyCodeWordMessage());
                return;
            }
            const codeWordValid = normalizeCodeWord(trimmed) === normalizeCodeWord(this.getConfig().codeWord);
            if (!codeWordValid) {
                await this.rejectCodeWord(ctx, data);
                return;
            }
            await this.acceptCodeWord(ctx, data);
            await this.finishApplication(ctx, {
                ...data,
                codeWord: trimmed,
                codeWordValid,
            });
        }
    }
    async acceptApplicationUsername(ctx, data, usernameText) {
        const message = await ctx.reply(applicationCodeStepMessage(), {
            parse_mode: "HTML",
            ...codeRulesKeyboard(this.getConfig()),
        });
        this.repos.setState(ctx.from.id, "application", "code", {
            ...data,
            usernameText,
            codePromptMessageId: message.message_id,
        });
    }
    async continueReservation(ctx, step, data, text) {
        const telegramId = ctx.from.id;
        const trimmed = text.trim();
        if (step === "role") {
            if (!trimmed) {
                await ctx.reply(emptyReservationRoleMessage());
                return;
            }
            const roleCheck = await this.roles.checkRole(trimmed);
            if (!roleCheck.ok) {
                await ctx.reply(roleValidationMessage(trimmed, roleCheck.reason), {
                    parse_mode: "HTML",
                    ...applicationRoleLinksKeyboard(this.getConfig()),
                });
                return;
            }
            const defaultUsername = ctx.from?.username ? `@${ctx.from.username}` : "";
            this.repos.setState(telegramId, "reservation", "username", { ...data, roleName: roleCheck.role });
            await ctx.reply(usernameStepMessage("2/4", defaultUsername), { parse_mode: "HTML", ...(defaultUsername ? confirmUsernameKeyboard() : {}) });
            return;
        }
        if (step === "username") {
            if (!trimmed) {
                await ctx.reply(emptyUsernameMessage());
                return;
            }
            await this.acceptReservationUsername(ctx, data, trimmed);
            return;
        }
        if (step === "code") {
            if (!trimmed) {
                await this.editCodePrompt(ctx, data, emptyCodeWordMessage());
                return;
            }
            const codeWordValid = normalizeCodeWord(trimmed) === normalizeCodeWord(this.getConfig().codeWord);
            if (!codeWordValid) {
                await this.rejectCodeWord(ctx, data);
                return;
            }
            await this.acceptCodeWord(ctx, data);
            this.repos.setState(telegramId, "reservation", "until", {
                ...data,
                codeWord: trimmed,
                codeWordValid,
            });
            await ctx.reply(reservationDateStepMessage(), {
                parse_mode: "HTML",
            });
            return;
        }
        if (step === "until") {
            const date = parseUserDate(trimmed);
            if (!date) {
                await ctx.reply(invalidDateMessage(), { parse_mode: "HTML" });
                return;
            }
            if (date.getTime() <= Date.now()) {
                await ctx.reply(pastDateMessage());
                return;
            }
            await this.finishReservation(ctx, { ...data, reserveUntil: date.toISOString() });
        }
    }
    async acceptReservationUsername(ctx, data, usernameText) {
        const message = await ctx.reply(reservationCodeStepMessage(), {
            parse_mode: "HTML",
            ...codeRulesKeyboard(this.getConfig()),
        });
        this.repos.setState(ctx.from.id, "reservation", "code", {
            ...data,
            usernameText,
            codePromptMessageId: message.message_id,
        });
    }
    async continueWaitlistReservation(ctx, step, data, text) {
        const telegramId = ctx.from.id;
        const trimmed = text.trim();
        if (step === "role") {
            if (!trimmed) {
                await ctx.reply(emptyReservationRoleMessage());
                return;
            }
            const roleCheck = await this.roles.checkRole(trimmed);
            if (!roleCheck.ok) {
                await ctx.reply(roleValidationMessage(trimmed, roleCheck.reason), {
                    parse_mode: "HTML",
                    ...applicationRoleLinksKeyboard(this.getConfig()),
                });
                return;
            }
            const defaultUsername = ctx.from?.username ? `@${ctx.from.username}` : "";
            this.repos.setState(telegramId, "waitlist_reservation", "username", { ...data, roleName: roleCheck.role });
            await ctx.reply(usernameStepMessage("2/3", defaultUsername), { parse_mode: "HTML", ...(defaultUsername ? confirmUsernameKeyboard() : {}) });
            return;
        }
        if (step === "username") {
            if (!trimmed) {
                await ctx.reply(emptyUsernameMessage());
                return;
            }
            await this.acceptWaitlistUsername(ctx, data, trimmed);
            return;
        }
        if (step === "code") {
            if (!trimmed) {
                await this.editCodePrompt(ctx, data, emptyCodeWordMessage());
                return;
            }
            const codeWordValid = normalizeCodeWord(trimmed) === normalizeCodeWord(this.getConfig().codeWord);
            if (!codeWordValid) {
                await this.rejectCodeWord(ctx, data);
                return;
            }
            await this.acceptCodeWord(ctx, data);
            await this.finishWaitlistReservation(ctx, {
                ...data,
                codeWord: trimmed,
                codeWordValid,
            });
        }
    }
    async acceptWaitlistUsername(ctx, data, usernameText) {
        const message = await ctx.reply(applicationCodeStepMessage(), {
            parse_mode: "HTML",
            ...codeRulesKeyboard(this.getConfig()),
        });
        this.repos.setState(ctx.from.id, "waitlist_reservation", "code", {
            ...data,
            usernameText,
            codePromptMessageId: message.message_id,
        });
    }
    async rejectCodeWord(ctx, data) {
        await this.editCodePrompt(ctx, data, invalidCodeWordMessage(), {
            parse_mode: "HTML",
            ...codeRulesKeyboard(this.getConfig()),
        });
    }
    async acceptCodeWord(ctx, data) {
        await this.editCodePrompt(ctx, data, codeWordAcceptedMessage(), {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [] },
        });
    }
    async editCodePrompt(ctx, data, text, extra = { parse_mode: "HTML", ...codeRulesKeyboard(this.getConfig()) }) {
        const chatId = ctx.chat?.id;
        if (!chatId || !data.codePromptMessageId) {
            await ctx.reply(text, extra);
            return;
        }
        try {
            await this.bot.telegram.editMessageText(chatId, data.codePromptMessageId, undefined, text, extra);
        }
        catch (error) {
            if (isMessageNotModifiedError(error))
                return;
            logger.warn({ error, messageId: data.codePromptMessageId }, "failed to edit code word prompt");
            await ctx.reply(text, extra);
        }
    }
    async replyBanned(ctx, user) {
        await ctx.reply(this.bannedMessage(user), appealBanKeyboard());
    }
    // Distinct wording for a manual admin ban (likely a rules violation) versus an
    // automatic ban after reaching the bot-join limit.
    bannedMessage(user) {
        if (user.ban_reason === "join_limit") {
            return joinLimitBannedMessage();
        }
        return manualBannedMessage();
    }
    // Users who are currently in the main chat must not be able to submit new
    // applications or reservations. Leaving the chat lets them apply again, up to
    // the join limit enforced in enforceJoinLimit.
    async blockIfAlreadyMember(ctx) {
        if (await this.subscriptions.isMainChatMember(ctx.from.id)) {
            await ctx.reply(alreadyMainChatMemberMessage());
            return true;
        }
        return false;
    }
    async continueReservationExtension(ctx, step, data, text) {
        if (step !== "date")
            return;
        const date = parseUserDate(text.trim());
        if (!date) {
            await ctx.reply(invalidDateMessage(), { parse_mode: "HTML" });
            return;
        }
        if (date.getTime() <= Date.now()) {
            await ctx.reply(pastDateMessage());
            return;
        }
        const reservation = this.repos.getReservationById(data.id);
        if (!reservation) {
            this.repos.clearState(ctx.from.id);
            await ctx.reply(reservationMissingForExtensionMessage());
            return;
        }
        const user = this.repos.getUserById(reservation.user_id);
        if (!user || user.telegram_id !== ctx.from.id) {
            this.repos.clearState(ctx.from.id);
            await ctx.reply(reservationExtensionForbiddenMessage());
            return;
        }
        this.repos.updateReservationDate(reservation.id, date.toISOString());
        this.repos.clearState(ctx.from.id);
        await ctx.reply(reservationExtendedMessage(reservation, date), { parse_mode: "HTML" });
        await safeSendMessage(this.bot, this.getConfig().adminChatId, reservationExtendedAdminMessage(user, reservation, date));
    }
    async finishApplication(ctx, data) {
        const user = this.repos.upsertUser({
            telegramId: ctx.from.id,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
        });
        const check = await this.subscriptions.check(ctx.from.id);
        const capacity = await this.mainChatCapacity();
        if (capacity.isFull) {
            await this.finishWaitlistReservation(ctx, {
                roleName: data.role,
                usernameText: data.usernameText,
                codeWord: data.codeWord,
                codeWordValid: data.codeWordValid,
            });
            return;
        }
        const app = this.repos.createApplication({
            userId: user.id,
            role: data.role,
            usernameText: data.usernameText,
            codeWordEntered: data.codeWord,
            codeWordValid: Boolean(data.codeWordValid),
            aboutText: "",
            lifeChannelSubscribed: check.life,
            infoChannelSubscribed: check.info,
        });
        this.repos.clearState(ctx.from.id);
        const expiresAt = addHours(new Date(), this.getConfig().inviteExpireHours);
        let inviteLink = null;
        try {
            const invite = await this.bot.telegram.createChatInviteLink(this.getConfig().mainChatId, {
                name: `app-${app.id}-u-${user.telegram_id}`,
                expire_date: toUnixSeconds(expiresAt),
                creates_join_request: true,
            });
            inviteLink = invite.invite_link;
            this.repos.createInviteLink({
                applicationId: app.id,
                userId: user.id,
                inviteLink,
                expiresAt: expiresAt.toISOString(),
            });
            this.repos.updateApplicationStatus(app.id, "approved", null);
        }
        catch (error) {
            logger.error({ error, applicationId: app.id }, "failed to create invite link after application");
            await safeSendMessage(this.bot, this.getConfig().adminChatId, applicationInviteCreationFailedAdminMessage(app.id));
        }
        const updatedApp = this.repos.getApplicationById(app.id) ?? app;
        const previousCount = Math.max(0, this.repos.countApplicationsByUserId(user.id) - 1);
        await safeReplyWithBanner(ctx, inviteLink
            ? "link_sending"
            : "cancel_link_sending", applicationSubmittedMessage(inviteLink), { parse_mode: "HTML" });
        await safeSendBanner(this.bot, this.getConfig().adminChatId, "questionnaire_to_admin_chat_sent", applicationCard(updatedApp, user, check, previousCount), withoutLinkPreview({
            parse_mode: "HTML",
        }));
    }
    async finishReservation(ctx, data) {
        const user = this.repos.upsertUser({
            telegramId: ctx.from.id,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
        });
        const check = await this.subscriptions.check(ctx.from.id);
        const reservation = this.repos.createReservation({
            userId: user.id,
            roleName: data.roleName,
            usernameText: data.usernameText,
            codeWordEntered: data.codeWord,
            codeWordValid: Boolean(data.codeWordValid),
            reserveUntil: data.reserveUntil,
            reservationKind: "scheduled",
        });
        this.repos.clearState(ctx.from.id);
        await safeReplyWithBanner(ctx, "under_consideration", reservationSubmittedMessage(), { parse_mode: "HTML" });
        await safeSendMessage(this.bot, this.getConfig().adminChatId, reservationCard(reservation, user, check), withoutLinkPreview({
            parse_mode: "HTML",
            ...adminReservationKeyboard(reservation.id),
        }));
    }
    async finishWaitlistReservation(ctx, data) {
        const user = this.repos.upsertUser({
            telegramId: ctx.from.id,
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
        });
        const check = await this.subscriptions.check(ctx.from.id);
        const reservation = this.repos.createReservation({
            userId: user.id,
            roleName: data.roleName,
            usernameText: data.usernameText,
            codeWordEntered: data.codeWord,
            codeWordValid: Boolean(data.codeWordValid),
            reservationKind: "waitlist",
        });
        this.repos.clearState(ctx.from.id);
        await safeReplyWithBanner(ctx, "under_consideration", waitlistSubmittedMessage(), { parse_mode: "HTML" });
        await safeSendMessage(this.bot, this.getConfig().adminChatId, reservationCard(reservation, user, check), withoutLinkPreview({
            parse_mode: "HTML",
            ...adminReservationKeyboard(reservation.id),
        }));
    }
    async retrySubscriptionCheck(ctx) {
        if (!ctx.from)
            return;
        const check = await this.subscriptions.check(ctx.from.id);
        if (!check.life || !check.info) {
            await ctx.reply(missingSubscriptionsMessage(check), { parse_mode: "HTML", ...missingSubscriptionsKeyboard(this.getConfig(), check) });
            return;
        }
        await ctx.reply(subscriptionsFoundMessage());
    }
    async expireReservations() {
        const due = this.repos.expireReservations();
        for (const reservation of due) {
            const user = this.repos.getUserById(reservation.user_id);
            if (!user)
                continue;
            await safeSendMessage(this.bot, user.telegram_id, `Наступил день брони роли «${reservation.role_name}».\n\nАктуальна ли ваша бронь?`, { ...reservationDueKeyboard(reservation.id) });
            await safeSendMessage(this.bot, this.getConfig().adminChatId, `Пользователю ${user.telegram_id} отправлено напоминание по брони #${reservation.id}: ${reservation.role_name}.`);
        }
        if (due.length)
            logger.info({ count: due.length }, "reservation reminders sent");
    }
    async checkWaitlistQueue() {
        const capacity = await this.mainChatCapacity();
        if (capacity.isFull)
            return;
        if (this.repos.hasActiveWaitlistGate(this.getConfig().inviteExpireHours))
            return;
        while (true) {
            const reservation = this.repos.getNextWaitlistReservation();
            if (!reservation)
                return;
            const user = this.repos.getUserById(reservation.user_id);
            if (!user) {
                this.repos.updateReservationStatus(reservation.id, "expired", null, "Пользователь не найден");
                continue;
            }
            this.repos.markWaitlistNotified(reservation.id);
            const sent = await safeSendMessage(this.bot, user.telegram_id, `В основном чате появилось место.\n\nБронь роли «${reservation.role_name}» ещё актуальна?`, { ...waitlistDueKeyboard(reservation.id) });
            if (!sent) {
                this.repos.updateReservationStatus(reservation.id, "expired", null, "Не удалось написать пользователю");
                await safeSendMessage(this.bot, this.getConfig().adminChatId, `Не удалось написать пользователю <code>${user.telegram_id}</code> по waitlist-брони #${reservation.id}. Бронь пропущена.`, { parse_mode: "HTML" });
                continue;
            }
            await safeSendMessage(this.bot, this.getConfig().adminChatId, `Пользователю <code>${user.telegram_id}</code> отправлен запрос актуальности waitlist-брони #${reservation.id}: <b>${escapeHtml(reservation.role_name)}</b>.`, { parse_mode: "HTML" });
            logger.info({ reservationId: reservation.id, userId: user.telegram_id }, "waitlist availability prompt sent");
            return;
        }
    }
    async mainChatCapacity() {
        const limit = this.getConfig().mainChatMemberLimit;
        const now = Date.now();
        if (this.mainChatCapacityCache && this.mainChatCapacityCache.limit === limit && this.mainChatCapacityCache.expiresAt > now) {
            return {
                count: this.mainChatCapacityCache.count,
                limit: this.mainChatCapacityCache.limit,
                isFull: this.mainChatCapacityCache.isFull,
            };
        }
        if (this.mainChatCapacityInFlight)
            return this.mainChatCapacityInFlight;
        this.mainChatCapacityInFlight = this.fetchMainChatCapacity(limit).finally(() => {
            this.mainChatCapacityInFlight = null;
        });
        return this.mainChatCapacityInFlight;
    }
    async fetchMainChatCapacity(limit) {
        try {
            const count = await this.bot.telegram.getChatMembersCount(this.getConfig().mainChatId);
            const capacity = { count, limit, isFull: count >= limit };
            this.mainChatCapacityCache = { ...capacity, expiresAt: Date.now() + mainChatCapacityCacheMs };
            return capacity;
        }
        catch (error) {
            logger.warn({ error }, "failed to get main chat member count");
            const capacity = { count: 0, limit, isFull: false };
            this.mainChatCapacityCache = { ...capacity, expiresAt: Date.now() + failedMainChatCapacityCacheMs };
            return capacity;
        }
    }
}
