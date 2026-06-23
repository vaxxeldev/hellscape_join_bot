import { safeAnswerCallback, safeEditMessageText } from "../services/telegram.js";
import { wipeDatabaseWithTelegram } from "../services/wipe.js";
import { escapeHtml } from "../utils/text.js";
import { logger } from "../utils/logger.js";
import { developerBackKeyboard, developerBroadcastButtonKeyboard, developerBroadcastConfirmKeyboard, developerBroadcastMediaKeyboard, developerPanelKeyboard, } from "./keyboards.js";
import { wipeDatabaseResultMessage } from "./messages.js";
import { pe, premiumEmoji } from "./premiumEmoji.js";
const broadcastDelayMs = 60;
export class DeveloperHandlers {
    bot;
    repos;
    roles;
    getConfig;
    constructor(bot, repos, roles, getConfig) {
        this.bot = bot;
        this.repos = repos;
        this.roles = roles;
        this.getConfig = getConfig;
    }
    register() {
        this.bot.command("developer", async (ctx) => this.openPanel(ctx));
        this.bot.command("broadcast", async (ctx) => this.startBroadcastCommand(ctx));
        this.bot.action("dev:back", async (ctx) => this.backToPanel(ctx));
        this.bot.action("dev:stats", async (ctx) => this.showStats(ctx));
        this.bot.action("dev:broadcast", async (ctx) => this.startBroadcastCallback(ctx));
        this.bot.action("dev:wipe", async (ctx) => this.wipeFromPanel(ctx));
        this.bot.action("dev:bc:skip_media", async (ctx) => this.skipBroadcastMedia(ctx));
        this.bot.action("dev:bc:add_button", async (ctx) => this.askBroadcastButtonText(ctx));
        this.bot.action("dev:bc:skip_button", async (ctx) => this.skipBroadcastButton(ctx));
        this.bot.action("dev:bc:confirm", async (ctx) => this.confirmBroadcast(ctx));
        this.bot.action("dev:bc:cancel", async (ctx) => this.cancelBroadcastPreview(ctx));
        this.bot.on("my_chat_member", async (ctx) => this.trackBotChat(ctx));
    }
    async handleMessage(ctx) {
        if (!this.isDeveloper(ctx) || ctx.chat?.type !== "private" || !ctx.from)
            return false;
        const state = this.repos.getState(ctx.from.id);
        if (state?.flow !== "developer_broadcast")
            return false;
        const message = ctx.message;
        if (!message)
            return false;
        if (message.text?.startsWith("/"))
            return false;
        const data = this.parseBroadcastData(state.data);
        if (state.step === "text") {
            await this.receiveBroadcastText(ctx, message, data);
            return true;
        }
        if (state.step === "media") {
            await this.receiveBroadcastMedia(ctx, message, data);
            return true;
        }
        if (state.step === "button_text") {
            await this.receiveBroadcastButtonText(ctx, message, data);
            return true;
        }
        if (state.step === "button_url") {
            await this.receiveBroadcastButtonUrl(ctx, message, data);
            return true;
        }
        return false;
    }
    async openPanel(ctx) {
        if (!this.isDeveloper(ctx))
            return;
        if (ctx.chat?.type !== "private") {
            await ctx.reply("Панель разработчика доступна только в личке с ботом.");
            return;
        }
        if (ctx.from)
            this.repos.clearState(ctx.from.id);
        await ctx.reply(developerPanelMessage(), {
            parse_mode: "HTML",
            ...developerPanelKeyboard(),
        });
    }
    async backToPanel(ctx) {
        if (!(await this.ensureDeveloperCallback(ctx)))
            return;
        if (ctx.from)
            this.repos.clearState(ctx.from.id);
        await safeEditMessageText(ctx, developerPanelMessage(), {
            parse_mode: "HTML",
            ...developerPanelKeyboard(),
        });
        await safeAnswerCallback(ctx);
    }
    async showStats(ctx) {
        if (!(await this.ensureDeveloperCallback(ctx)))
            return;
        await safeEditMessageText(ctx, developerStatsMessage(this.repos.developerStats(), this.roles.catalogStats(), this.getConfig()), {
            parse_mode: "HTML",
            ...developerBackKeyboard(),
        });
        await safeAnswerCallback(ctx);
    }
    async startBroadcastCommand(ctx) {
        if (!this.isDeveloper(ctx))
            return;
        if (ctx.chat?.type !== "private" || !ctx.from) {
            await ctx.reply("Рассылка доступна только в личке с ботом.");
            return;
        }
        const message = await ctx.reply(broadcastStepTextMessage(), {
            parse_mode: "HTML",
            ...developerBackKeyboard(),
        });
        this.repos.setState(ctx.from.id, "developer_broadcast", "text", {
            controlMessageId: message.message_id,
        });
    }
    async startBroadcastCallback(ctx) {
        if (!(await this.ensureDeveloperCallback(ctx)))
            return;
        const messageId = this.callbackMessageId(ctx);
        if (!ctx.from || !ctx.chat || !messageId)
            return;
        this.repos.setState(ctx.from.id, "developer_broadcast", "text", {
            controlMessageId: messageId,
        });
        await safeEditMessageText(ctx, broadcastStepTextMessage(), {
            parse_mode: "HTML",
            ...developerBackKeyboard(),
        });
        await safeAnswerCallback(ctx);
    }
    async receiveBroadcastText(ctx, message, data) {
        const text = message.text ?? message.caption ?? "";
        if (!text.trim()) {
            await ctx.reply("Отправьте текст или подпись для рассылки.");
            return;
        }
        await this.tryDeleteMessage(ctx.chat.id, message.message_id);
        const nextData = {
            ...data,
            text,
            entities: message.entities ?? message.caption_entities ?? [],
        };
        this.repos.setState(ctx.from.id, "developer_broadcast", "media", nextData);
        await this.editControlMessage(ctx.chat.id, data.controlMessageId, broadcastStepMediaMessage(), {
            parse_mode: "HTML",
            ...developerBroadcastMediaKeyboard(),
        });
    }
    async receiveBroadcastMedia(ctx, message, data) {
        const photoFileId = lastPhotoFileId(message);
        const videoFileId = message.video?.file_id;
        const animationFileId = message.animation?.file_id;
        if (!photoFileId && !videoFileId && !animationFileId) {
            await ctx.reply("Можно отправить фото, видео или GIF. Либо нажмите «Пропустить медиа».");
            return;
        }
        await this.tryDeleteMessage(ctx.chat.id, message.message_id);
        await this.askBroadcastButton(ctx.chat.id, ctx.from.id, {
            ...data,
            photoFileId,
            videoFileId,
            animationFileId,
        });
    }
    async skipBroadcastMedia(ctx) {
        if (!(await this.ensureDeveloperCallback(ctx)))
            return;
        const state = this.getBroadcastState(ctx);
        if (!state || state.step !== "media") {
            await safeAnswerCallback(ctx, "Сейчас не ожидается медиа.", true);
            return;
        }
        await this.askBroadcastButton(ctx.chat.id, ctx.from.id, {
            ...this.parseBroadcastData(state.data),
            photoFileId: undefined,
            videoFileId: undefined,
            animationFileId: undefined,
        });
        await safeAnswerCallback(ctx);
    }
    async askBroadcastButton(chatId, telegramId, data) {
        this.repos.setState(telegramId, "developer_broadcast", "button_choice", data);
        await this.editControlMessage(chatId, data.controlMessageId, broadcastStepButtonChoiceMessage(), {
            parse_mode: "HTML",
            ...developerBroadcastButtonKeyboard(),
        });
    }
    async askBroadcastButtonText(ctx) {
        if (!(await this.ensureDeveloperCallback(ctx)))
            return;
        const state = this.getBroadcastState(ctx);
        if (!state || state.step !== "button_choice") {
            await safeAnswerCallback(ctx, "Сейчас нельзя добавить кнопку.", true);
            return;
        }
        const data = this.parseBroadcastData(state.data);
        this.repos.setState(ctx.from.id, "developer_broadcast", "button_text", data);
        await safeEditMessageText(ctx, broadcastStepButtonTextMessage(), {
            parse_mode: "HTML",
            ...developerBackKeyboard(),
        });
        await safeAnswerCallback(ctx);
    }
    async receiveBroadcastButtonText(ctx, message, data) {
        const parsed = parseButtonText(message.text ?? "", message.entities ?? []);
        if (!parsed.text && !parsed.emojiId) {
            await ctx.reply("Текст кнопки не может быть пустым.");
            return;
        }
        await this.tryDeleteMessage(ctx.chat.id, message.message_id);
        const nextData = {
            ...data,
            buttonText: parsed.text || "·",
            buttonEmojiId: parsed.emojiId,
        };
        this.repos.setState(ctx.from.id, "developer_broadcast", "button_url", nextData);
        await this.editControlMessage(ctx.chat.id, data.controlMessageId, broadcastStepButtonUrlMessage(), {
            parse_mode: "HTML",
            ...developerBackKeyboard(),
        });
    }
    async receiveBroadcastButtonUrl(ctx, message, data) {
        const url = (message.text ?? "").trim();
        if (!isHttpUrl(url)) {
            await ctx.reply("Нужна корректная ссылка формата https://...");
            return;
        }
        await this.tryDeleteMessage(ctx.chat.id, message.message_id);
        await this.showBroadcastPreview(ctx.chat.id, ctx.from.id, {
            ...data,
            buttonUrl: url,
        });
    }
    async skipBroadcastButton(ctx) {
        if (!(await this.ensureDeveloperCallback(ctx)))
            return;
        const state = this.getBroadcastState(ctx);
        if (!state || state.step !== "button_choice") {
            await safeAnswerCallback(ctx, "Сейчас нельзя пропустить кнопку.", true);
            return;
        }
        await this.showBroadcastPreview(ctx.chat.id, ctx.from.id, {
            ...this.parseBroadcastData(state.data),
            buttonText: null,
            buttonUrl: null,
            buttonEmojiId: null,
        });
        await safeAnswerCallback(ctx);
    }
    async showBroadcastPreview(chatId, telegramId, data) {
        await this.editControlMessage(chatId, data.controlMessageId, broadcastPreviewControlMessage(), {
            parse_mode: "HTML",
        });
        const header = await this.bot.telegram.sendMessage(chatId, broadcastPreviewHeaderMessage(), { parse_mode: "HTML" });
        const preview = await this.sendBroadcastPayload(chatId, data);
        const confirm = await this.bot.telegram.sendMessage(chatId, broadcastConfirmMessage(), {
            parse_mode: "HTML",
            ...developerBroadcastConfirmKeyboard(),
        });
        this.repos.setState(telegramId, "developer_broadcast", "confirm", {
            ...data,
            previewHeaderMessageId: header.message_id,
            previewMessageId: preview.message_id,
            confirmMessageId: confirm.message_id,
        });
    }
    async confirmBroadcast(ctx) {
        if (!(await this.ensureDeveloperCallback(ctx)))
            return;
        const state = this.getBroadcastState(ctx);
        if (!state || state.step !== "confirm") {
            await safeAnswerCallback(ctx, "Сейчас нечего отправлять.", true);
            return;
        }
        const data = this.parseBroadcastData(state.data);
        await this.cleanupBroadcastPreview(ctx.chat.id, data);
        this.repos.clearState(ctx.from.id);
        const recipients = this.repos.listBroadcastRecipients();
        await this.editControlMessage(ctx.chat.id, data.controlMessageId, broadcastStartedMessage(recipients.length), {
            parse_mode: "HTML",
        });
        let success = 0;
        let failed = 0;
        for (const recipient of recipients) {
            try {
                await this.sendBroadcastPayload(recipient.telegram_id, data);
                success += 1;
            }
            catch (error) {
                failed += 1;
                logger.warn({ error, telegramId: recipient.telegram_id }, "failed to send broadcast message");
            }
            await wait(broadcastDelayMs);
        }
        await this.editControlMessage(ctx.chat.id, data.controlMessageId, broadcastFinishedMessage(success, failed), {
            parse_mode: "HTML",
            ...developerBackKeyboard(),
        });
        await safeAnswerCallback(ctx);
    }
    async cancelBroadcastPreview(ctx) {
        if (!(await this.ensureDeveloperCallback(ctx)))
            return;
        const state = this.getBroadcastState(ctx);
        const data = state ? this.parseBroadcastData(state.data) : {};
        if (ctx.chat)
            await this.cleanupBroadcastPreview(ctx.chat.id, data);
        if (ctx.from)
            this.repos.clearState(ctx.from.id);
        await this.editControlMessage(ctx.chat.id, data.controlMessageId ?? this.callbackMessageId(ctx), developerPanelMessage(), {
            parse_mode: "HTML",
            ...developerPanelKeyboard(),
        });
        await safeAnswerCallback(ctx);
    }
    async wipeFromPanel(ctx) {
        if (!(await this.ensureDeveloperCallback(ctx)))
            return;
        const result = await wipeDatabaseWithTelegram(this.bot, this.repos, this.getConfig);
        await ctx.reply(wipeDatabaseResultMessage(result), { parse_mode: "HTML" });
        await safeAnswerCallback(ctx, "База данных очищена.");
    }
    async trackBotChat(ctx) {
        const update = ctx.update;
        const membership = update.my_chat_member;
        if (!membership)
            return;
        this.repos.upsertBotChat({
            chatId: membership.chat.id,
            type: membership.chat.type,
            title: membership.chat.title,
            username: membership.chat.username,
            status: membership.new_chat_member.status,
        });
    }
    async sendBroadcastPayload(chatId, data) {
        const markup = broadcastReplyMarkup(data);
        const text = data.text ?? "";
        if (data.photoFileId) {
            return this.bot.telegram.sendPhoto(chatId, data.photoFileId, {
                caption: text,
                caption_entities: data.entities,
                ...markup,
            });
        }
        if (data.videoFileId) {
            return this.bot.telegram.sendVideo(chatId, data.videoFileId, {
                caption: text,
                caption_entities: data.entities,
                ...markup,
            });
        }
        if (data.animationFileId) {
            return this.bot.telegram.sendAnimation(chatId, data.animationFileId, {
                caption: text,
                caption_entities: data.entities,
                ...markup,
            });
        }
        return this.bot.telegram.sendMessage(chatId, text, {
            entities: data.entities,
            ...markup,
        });
    }
    async editControlMessage(chatId, messageId, text, extra) {
        if (!messageId) {
            await this.bot.telegram.sendMessage(chatId, text, extra);
            return;
        }
        try {
            await this.bot.telegram.editMessageText(chatId, messageId, undefined, text, extra);
        }
        catch (error) {
            logger.warn({ error, messageId }, "failed to edit developer control message");
            await this.bot.telegram.sendMessage(chatId, text, extra);
        }
    }
    async cleanupBroadcastPreview(chatId, data) {
        await this.tryDeleteMessage(chatId, data.confirmMessageId);
        await this.tryDeleteMessage(chatId, data.previewMessageId);
        await this.tryDeleteMessage(chatId, data.previewHeaderMessageId);
    }
    async tryDeleteMessage(chatId, messageId) {
        if (!messageId)
            return;
        try {
            await this.bot.telegram.deleteMessage(chatId, messageId);
        }
        catch {
            // Best-effort cleanup only.
        }
    }
    getBroadcastState(ctx) {
        if (!ctx.from)
            return null;
        const state = this.repos.getState(ctx.from.id);
        return state?.flow === "developer_broadcast" ? state : null;
    }
    parseBroadcastData(raw) {
        try {
            return JSON.parse(raw);
        }
        catch {
            return {};
        }
    }
    isDeveloper(ctx) {
        const developerId = this.getConfig().developerId;
        return Boolean(developerId && ctx.from?.id === developerId);
    }
    async ensureDeveloperCallback(ctx) {
        if (!this.isDeveloper(ctx)) {
            await safeAnswerCallback(ctx);
            return false;
        }
        if (ctx.chat?.type !== "private") {
            await safeAnswerCallback(ctx, "Панель разработчика доступна только в личке.", true);
            return false;
        }
        return true;
    }
    callbackMessageId(ctx) {
        const callbackQuery = ctx.callbackQuery;
        if (callbackQuery && "message" in callbackQuery && callbackQuery.message) {
            return callbackQuery.message.message_id;
        }
        return undefined;
    }
}
function developerPanelMessage() {
    return `${pe(premiumEmoji.settings, "⚙️")} <b>Панель разработчика</b>
<blockquote>Закрытая зона управления ботом. Доступ проверяется по <code>DEVELOPER_ID</code>.</blockquote>

Выберите действие ниже.`;
}
function developerStatsMessage(stats, roleCatalog, config) {
    const connectedChatIds = new Set([config.lifeChannelId, config.infoChannelId, config.mainChatId, config.adminChatId]);
    const admins = config.adminIds.size;
    return `${pe(premiumEmoji.statsChart, "📊")} <b>Статистика бота</b>
<blockquote>Обновлено: <code>${escapeHtml(new Date().toLocaleString("ru-RU"))}</code></blockquote>

╭ <b>Люди и доступ</b>
├ Пользователи в базе: <code>${stats.users.total}</code>
├ Получатели рассылки: <code>${stats.users.broadcastRecipients}</code>
├ Заблокированы: <code>${stats.users.banned}</code>
╰ Админы в конфиге: <code>${admins}</code>

╭ <b>Анкеты</b>
├ Всего: <code>${stats.applications.total}</code> · сегодня: <code>${stats.applications.today}</code>
├ Ожидают: <code>${stats.applications.pending}</code>
├ Одобрены: <code>${stats.applications.approved}</code>
├ Отклонены: <code>${stats.applications.rejected}</code>
╰ Вступили: <code>${stats.applications.joined}</code>

╭ <b>Брони ролей</b>
├ Всего: <code>${stats.reservations.total}</code>
├ Ожидают: <code>${stats.reservations.pending}</code> · одобрены: <code>${stats.reservations.approved}</code>
├ Waitlist: <code>${stats.reservations.waitlist}</code>
╰ Закрыты: <code>${stats.reservations.used + stats.reservations.expired + stats.reservations.rejected}</code>

╭ <b>Должности</b>
├ Каталог: <code>${roleCatalog.total}</code> (<code>${roleCatalog.genshin}</code> GI / <code>${roleCatalog.hsr}</code> HSR)
├ Заняты по анкетам: <code>${stats.roles.occupiedFromApplications}</code>
╰ Забронированы в боте: <code>${stats.roles.reservedFromReservations}</code>

╭ <b>Каналы и чаты</b>
├ Подключено в .env: <code>${connectedChatIds.size}</code>
├ Обязательные каналы: <code>2</code>
├ Отслеживаемые чаты бота: <code>${stats.botChats.active}</code>
├ Из них каналы: <code>${stats.botChats.channels}</code>
╰ Группы/супергруппы: <code>${stats.botChats.groups}</code>

╭ <b>Вступление</b>
├ Invite-ссылки: <code>${stats.inviteLinks.total}</code> · активные: <code>${stats.inviteLinks.active}</code>
├ Join-заявки: <code>${stats.joinRequests.total}</code> · ожидают: <code>${stats.joinRequests.pending}</code>
╰ Состояния FSM: <code>${stats.service.userStates}</code>`;
}
function broadcastStepTextMessage() {
    return `${pe(premiumEmoji.announcement, "📨")} <b>Рассылка · шаг 1/5</b>
<blockquote>Отправьте текст сообщения. Форматирование Telegram сохранится, если вы отправите уже оформленный текст.</blockquote>

Можно отправить обычный текст или подпись к медиа.`;
}
function broadcastStepMediaMessage() {
    return `${pe(premiumEmoji.media, "🖼")} <b>Рассылка · шаг 2/5</b>
<blockquote>Отправьте медиа для рассылки: фото, видео или GIF.</blockquote>

Если медиа не нужно, нажмите «Пропустить медиа».`;
}
function broadcastStepButtonChoiceMessage() {
    return `${pe(premiumEmoji.link, "🔗")} <b>Рассылка · шаг 3/5</b>
<blockquote>Можно добавить одну inline-кнопку со ссылкой под сообщением.</blockquote>`;
}
function broadcastStepButtonTextMessage() {
    return `${pe(premiumEmoji.font, "🔤")} <b>Рассылка · шаг 4/5</b>
<blockquote>Введите текст кнопки. Если отправите custom emoji вместе с текстом, бот попробует сохранить его как иконку кнопки.</blockquote>`;
}
function broadcastStepButtonUrlMessage() {
    return `${pe(premiumEmoji.link, "🔗")} <b>Рассылка · шаг 5/5</b>
<blockquote>Введите URL для кнопки. Нужна ссылка с <code>http://</code> или <code>https://</code>.</blockquote>`;
}
function broadcastPreviewControlMessage() {
    return `${pe(premiumEmoji.eye, "👁")} <b>Предпросмотр рассылки</b>
<blockquote>Проверьте сообщение ниже и подтвердите отправку.</blockquote>`;
}
function broadcastPreviewHeaderMessage() {
    return `${pe(premiumEmoji.eye, "👁")} <b>Предпросмотр:</b>`;
}
function broadcastConfirmMessage() {
    return `${pe(premiumEmoji.notification, "❓")} <b>Отправить рассылку всем доступным пользователям?</b>`;
}
function broadcastStartedMessage(total) {
    return `${pe(premiumEmoji.send, "📤")} <b>Рассылка начата</b>
<blockquote>Получателей: <code>${total}</code>. Отправляю с небольшой паузой, чтобы не упереться в лимиты Telegram.</blockquote>`;
}
function broadcastFinishedMessage(success, failed) {
    return `${pe(premiumEmoji.check, "✅")} <b>Рассылка завершена</b>

╭ <b>Итог</b>
├ Успешно: <code>${success}</code>
╰ Ошибок: <code>${failed}</code>`;
}
function broadcastReplyMarkup(data) {
    if (!data.buttonUrl || (!data.buttonText && !data.buttonEmojiId))
        return {};
    const button = {
        text: data.buttonText || "·",
        url: data.buttonUrl,
    };
    if (data.buttonEmojiId)
        button.icon_custom_emoji_id = data.buttonEmojiId;
    return {
        reply_markup: {
            inline_keyboard: [[button]],
        },
    };
}
function parseButtonText(text, entities) {
    let buttonText = text.trim();
    let emojiId = null;
    const customEmoji = entities.find((entity) => entity.type === "custom_emoji" && entity.custom_emoji_id);
    if (customEmoji?.custom_emoji_id) {
        emojiId = customEmoji.custom_emoji_id;
        buttonText = `${text.slice(0, customEmoji.offset)}${text.slice(customEmoji.offset + customEmoji.length)}`.trim();
    }
    return { text: buttonText, emojiId };
}
function lastPhotoFileId(message) {
    const photo = message.photo?.at(-1);
    return photo?.file_id;
}
function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    }
    catch {
        return false;
    }
}
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
