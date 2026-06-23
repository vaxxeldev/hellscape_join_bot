import type { AppConfig } from "../config/env.js";
import type {
  ApplicationRecord,
  InviteLinkRecord,
  JoinRequestRecord,
  RoleReservationRecord,
  SubscriptionCheck,
  UserRecord,
} from "../types.js";
import { escapeHtml, formatName, mentionUser, profileLink, usernameOrDash } from "../utils/text.js";
import { formatDate } from "../utils/time.js";
import { pe, premiumEmoji } from "./premiumEmoji.js";
import { applicationStatusHtml, reservationStatusLabel } from "./statusLabels.js";

function mark(value: boolean | number) {
  return value ? pe(premiumEmoji.check, "✅") : pe(premiumEmoji.cross, "❌");
}

export function welcomeMessage() {
  return `${pe(premiumEmoji.bot, "🤖")} <b>𝗛ΞᒪᒪSᑕᗩⱣE Helper</b>
Бот принимает анкеты на вступление и заявки на бронь ролей.

<blockquote><b>Анкета</b>
Роль, username и кодовое слово.</blockquote>

<blockquote><b>Бронь роли</b>
Роль, username и дата, до которой держать бронь.</blockquote>

Личные вопросы бот не обрабатывает. Выберите действие ниже.`;
}

export function helpMessage() {
  return `${pe(premiumEmoji.info, "ℹ")} <b>Команды</b>
<code>/start</code> — меню
<code>/status</code> — статус анкеты
<code>/reserve</code> — бронь роли
<code>/my_reserve</code> — моя бронь
<code>/rules</code> — правила
<code>/cancel</code> — отмена заполнения`;
}

export function adminHelpMessage() {
  return `${pe(premiumEmoji.settings, "⚙")} <b>Админ-команды</b>
<code>/admin</code> — панель
<code>/stats</code> — статистика
<code>/applications</code> — последние анкеты
<code>/app ID</code> — открыть анкету
<code>/ban USER_ID|@username</code> — запретить анкеты
<code>/unban USER_ID|@username</code> — снять запрет
<code>/reservations</code> — активные брони
<code>/expire_reserve ID</code> — закрыть бронь
<code>/use_reserve ID</code> — отметить использованной
<code>/reload</code> — перечитать .env`;
}

export function missingSubscriptionsMessage(check: SubscriptionCheck) {
  const lines = [`${pe(premiumEmoji.lockClosed, "🔒")} <b>Нужна подписка</b>`, "Подпишитесь на:"];
  if (!check.life) lines.push(`• ${pe(premiumEmoji.announcement, "📣")} лайф-канал`);
  if (!check.info) lines.push(`• ${pe(premiumEmoji.info, "ℹ")} инфо-канал`);
  lines.push("", `Потом нажмите <b>Проверить подписку</b>.`);
  return lines.join("\n");
}

export function subscriptionsConfirmedMessage() {
  return `${pe(premiumEmoji.check, "✅")} <b>Подписки подтверждены</b>\nМожно продолжать.`;
}

export function recruitmentClosedMessage(memberCount: number, memberLimit: number) {
  return `${pe(premiumEmoji.lockClosed, "🔒")} <b>Набор временно закрыт</b>
В основном чате сейчас <code>${memberCount}</code>/<code>${memberLimit}</code> участников.

Подать анкету сейчас нельзя. Можно забронировать роль в очередь закрытого набора: когда появится место, бот напишет первому пользователю в очереди и уточнит актуальность брони.`;
}

export function applicationCard(
  app: ApplicationRecord,
  user: UserRecord,
  subscriptions: SubscriptionCheck,
  previousCount: number,
) {
  return `${pe(premiumEmoji.file, "📁")} <b>Анкета #${app.id}</b> · <code>${applicationStatusHtml(app.status, app.reject_reason)}</code>

╭ <b>Пользователь</b>
├ ${mentionUser(user)}
├ ID: <code>${user.telegram_id}</code>
╰ Username: ${escapeHtml(usernameOrDash(user.username))}

╭ <b>Анкета</b>
├ Роль: <b>${escapeHtml(app.role)}</b>
├ Контакт: ${escapeHtml(app.username_text)}
╰ Подана: ${escapeHtml(formatDate(app.created_at))}

╭ <b>Проверки</b>
├ Лайф канал: ${mark(subscriptions.life)}
├ Инфо канал: ${mark(subscriptions.info)}
├ Кодовое слово: ${mark(app.code_word_valid)} | <code>${escapeHtml(app.code_word_entered)}</code>
╰ Прошлых анкет: <code>${previousCount}</code>`;
}

export function reservationCard(reservation: RoleReservationRecord, user: UserRecord, subscriptions: SubscriptionCheck) {
  const reserveUntil =
    reservation.reservation_kind === "waitlist"
      ? "до появления места в основном чате"
      : escapeHtml(formatDate(reservation.reserve_until));

  return `${pe(premiumEmoji.clock, "⏰")} <b>Бронь #${reservation.id}</b> · <code>${reservationStatusLabel(reservation.status)}</code>

╭ <b>Пользователь</b>
├ ${mentionUser(user)}
├ ID: <code>${user.telegram_id}</code>
╰ Username: ${escapeHtml(usernameOrDash(user.username))}

╭ <b>Бронь</b>
├ Роль: <b>${escapeHtml(reservation.role_name)}</b>
├ Контакт: ${escapeHtml(reservation.username_text)}
╰ До: ${reserveUntil}

╭ <b>Проверки</b>
├ Лайф канал: ${mark(subscriptions.life)}
├ Инфо канал: ${mark(subscriptions.info)}
╰ Кодовое слово: ${mark(reservation.code_word_valid)} | <code>${escapeHtml(reservation.code_word_entered)}</code>`;
}

export function joinRequestCard(input: {
  request: JoinRequestRecord;
  app: ApplicationRecord;
  user: UserRecord;
  invite: InviteLinkRecord;
  subscriptions: SubscriptionCheck;
}) {
  return `${pe(premiumEmoji.userApproved, "👤")} <b>Заявка в основной чат #${input.request.id}</b>

╭ <b>Пользователь</b>
├ ${mentionUser(input.user)}
├ ID: <code>${input.user.telegram_id}</code>
╰ Username: ${escapeHtml(usernameOrDash(input.user.username))}

╭ <b>Анкета</b>
├ ID: <code>${input.app.id}</code>
├ Роль: <b>${escapeHtml(input.app.role)}</b>
╰ Одобрена: ${escapeHtml(formatDate(input.app.reviewed_at))}

╭ <b>Проверки</b>
├ Личная ссылка: ${pe(premiumEmoji.check, "✅")}
├ Анкета: ${pe(premiumEmoji.check, "✅")}
├ Подписки: ${mark(input.subscriptions.life && input.subscriptions.info)}
╰ Ссылка активна: ${mark(input.invite.status === "active")}`;
}

export function profileText(user: UserRecord) {
  return `${pe(premiumEmoji.profile, "👤")} <b>Профиль</b>
╭ Имя: ${escapeHtml(formatName(user))}
├ ID: <code>${user.telegram_id}</code>
├ Username: ${escapeHtml(usernameOrDash(user.username))}
├ Ссылка: ${escapeHtml(profileLink(user))}
╰ Блокировка: ${mark(user.is_banned)}`;
}

export function rulesMessage(config: AppConfig) {
  return `${pe(premiumEmoji.file, "📁")} <b>Правила</b>
Кодовое слово находится в правилах:
${config.rulesUrl}`;
}

type BotStats = {
  total: number;
  today: number;
  uniqueUsers: number;
  pending: number;
  approved: number;
  rejected: number;
  joined: number;
};

export function noApplicationsMessage() {
  return "Анкет пока нет. Можно подать первую через меню.";
}

export function noApplicationsForAdminMessage() {
  return "Анкет пока нет.";
}

export function applicationStatusMessage(app: ApplicationRecord) {
  return `<b>Анкета #${app.id}</b>\nСтатус: <code>${applicationStatusHtml(app.status, app.reject_reason)}</code>`;
}

export function noActiveReservationMessage() {
  return "Активной брони нет. Можно создать заявку командой /reserve.";
}

export function activeReservationMessage(reservation: RoleReservationRecord) {
  return `<b>Бронь #${reservation.id}</b>\nРоль: ${escapeHtml(reservation.role_name)}\nСтатус: <code>${reservationStatusLabel(
    reservation.status,
  )}</code>\nДо: ${escapeHtml(formatDate(reservation.reserve_until))}`;
}

export function adminPanelMessage(stats: BotStats) {
  return `<b>Админ-панель</b>\nАнкет: <code>${stats.total}</code>\nОжидают проверки: <code>${stats.pending}</code>\nОдобрены: <code>${stats.approved}</code>\nОтклонены: <code>${stats.rejected}</code>\nВступили в чат: <code>${stats.joined}</code>\n\n<code>/help_admin</code> — команды`;
}

export function statsMessage(stats: BotStats) {
  return `<b>Статистика</b>\nВсего: <code>${stats.total}</code>\nСегодня: <code>${stats.today}</code>\nПользователей: <code>${stats.uniqueUsers}</code>\n\nОжидают проверки: <code>${stats.pending}</code>\nОдобрены: <code>${stats.approved}</code>\nОтклонены: <code>${stats.rejected}</code>\nВступили в чат: <code>${stats.joined}</code>`;
}

export function applicationsListMessage(apps: ApplicationRecord[]) {
  return apps
    .map(
      (app) =>
        `#${app.id} · <code>${applicationStatusHtml(app.status, app.reject_reason)}</code> · пользователь <code>${app.user_id}</code> · ${escapeHtml(
          app.role,
        )} · ${escapeHtml(formatDate(app.created_at))}`,
    )
    .join("\n");
}

export function openApplicationUsageMessage() {
  return "Использование: /app ID";
}

export function applicationNotFoundMessage() {
  return "Анкета не найдена.";
}

export function applicationUserNotFoundMessage() {
  return "Пользователь анкеты не найден.";
}

export function banUsageMessage(isBanned: boolean) {
  return isBanned
    ? "Использование: <code>/ban USER_ID</code> или <code>/ban @username</code>"
    : "Использование: <code>/unban USER_ID</code> или <code>/unban @username</code>";
}

export function userNotFoundInDatabaseMessage() {
  return "Пользователь не найден в базе. Он должен хотя бы раз написать боту; для поиска по @username этот username должен быть в его профиле.";
}

export function banResultMessage(user: UserRecord, isBanned: boolean) {
  const label = `${escapeHtml(usernameOrDash(user.username))} <code>${user.telegram_id}</code>`;
  return isBanned ? `Пользователь ${label} заблокирован.` : `Пользователь ${label} разблокирован.`;
}

export function configReloadedMessage() {
  return "Конфиг перечитан из .env. BOT_TOKEN для текущего процесса не меняется до перезапуска.";
}

export function noReservationsMessage() {
  return "Активных броней нет.";
}

export function reservationsListMessage(reservations: RoleReservationRecord[]) {
  return reservations
    .map(
      (item) =>
        `#${item.id} · <code>${reservationStatusLabel(item.status)}</code> · ${escapeHtml(item.role_name)} · до ${escapeHtml(
          formatDate(item.reserve_until),
        )} · пользователь <code>${item.user_id}</code>`,
    )
    .join("\n");
}

export function changeReservationUsageMessage(status: "expired" | "used") {
  return status === "expired" ? "Использование: /expire_reserve ID" : "Использование: /use_reserve ID";
}

export function reservationNotFoundMessage() {
  return "Бронь не найдена.";
}

export function reservationStatusChangedMessage(id: number, status: "expired" | "used") {
  return `Бронь <code>#${id}</code> теперь в статусе <code>${reservationStatusLabel(status)}</code>.`;
}

export function wipeDatabaseResultMessage(input: {
  users: number;
  applications: number;
  inviteLinks: number;
  joinRequests: number;
  roleReservations: number;
  adminActions: number;
  userStates: number;
  revokedInviteLinks: number;
  failedInviteRevokes: number;
}) {
  return `<b>База данных очищена</b>
Пользователей удалено: <code>${input.users}</code>
Анкет удалено: <code>${input.applications}</code>
Броней удалено: <code>${input.roleReservations}</code>
Invite-ссылок в БД удалено: <code>${input.inviteLinks}</code>
Заявок на вступление удалено: <code>${input.joinRequests}</code>
Состояний заполнения удалено: <code>${input.userStates}</code>
Админ-действий удалено: <code>${input.adminActions}</code>
Активных invite-ссылок отозвано в Telegram: <code>${input.revokedInviteLinks}</code>
Не удалось отозвать ссылок: <code>${input.failedInviteRevokes}</code>`;
}

export function adminOnlyCommandMessage() {
  return "Эта команда доступна только администрации.";
}

export function applicationPrivateOnlyMessage() {
  return "Анкету нужно заполнять в личных сообщениях с ботом.";
}

export function reservationPrivateOnlyMessage() {
  return "Бронь нужно заполнять в личных сообщениях с ботом.";
}

export function waitlistPrivateOnlyMessage() {
  return "Бронь закрытого набора нужно заполнить в личных сообщениях с ботом.";
}

export function activeApplicationExistsMessage(applicationId: number) {
  return `У вас уже есть анкета #${applicationId} в обработке. Дождитесь решения — статус можно посмотреть через /status.`;
}

export function tooManyApplicationsMessage() {
  return "Вы подали слишком много анкет за сутки. Попробуйте позже.";
}

export function activeReservationExistsMessage() {
  return "У вас уже есть активная бронь. Посмотреть её можно через /my_reserve.";
}

export function applicationRoleStepMessage() {
  return "<b>Шаг 1/3</b>\nУкажите желаемую роль.\n\nСписки ролей:";
}

export function reservationRoleStepMessage() {
  return "<b>Шаг 1/4</b>\nУкажите роль для брони.\n\nСписки ролей:";
}

export function waitlistRoleStepMessage() {
  return "<b>Шаг 1/3</b>\nУкажите роль для брони в очереди закрытого набора.\n\nСписки ролей:";
}

export function fillingCancelledMessage() {
  return "Заполнение отменено.";
}

export function profileUsernameMissingMessage() {
  return "В профиле нет username. Напишите контакт вручную.";
}

export function emptyApplicationRoleMessage() {
  return "Роль не может быть пустой. Укажите желаемую роль.";
}

export function emptyReservationRoleMessage() {
  return "Роль не может быть пустой. Укажите роль для брони.";
}

export function usernameStepMessage(step: "2/3" | "2/4", defaultUsername: string) {
  return defaultUsername
    ? `<b>Шаг ${step}</b>\nUsername из профиля: <code>${escapeHtml(defaultUsername)}</code>\nНажмите <b>Подтвердить</b> или напишите другой.`
    : `<b>Шаг ${step}</b>\nНапишите контактный username.\nПример: <code>@username</code>`;
}

export function emptyApplicationUsernameMessage() {
  return "Username не может быть пустым. Напишите @username или контактный юз.";
}

export function emptyUsernameMessage() {
  return "Username не может быть пустым.";
}

export function emptyCodeWordMessage() {
  return "Кодовое слово не может быть пустым.";
}

export function applicationCodeStepMessage() {
  return "<b>Шаг 3/3</b>\nВведите кодовое слово из правил.";
}

export function reservationCodeStepMessage() {
  return "<b>Шаг 3/4</b>\nВведите кодовое слово из правил.";
}

export function invalidCodeWordMessage() {
  return "<b>Кодовое слово неверное</b>\nПроверьте правила и попробуйте ещё раз.";
}

export function codeWordAcceptedMessage() {
  return "<b>Кодовое слово принято</b>\nПродолжаю оформление.";
}

export function reservationDateStepMessage() {
  return "<b>Шаг 4/4</b>\nДо какого числа нужна бронь?\nФормат: <code>ДД.ММ.ГГГГ</code>";
}

export function invalidDateMessage() {
  return "Не смог распознать дату. Формат: <code>ДД.ММ.ГГГГ</code>";
}

export function pastDateMessage() {
  return "Дата брони не может быть в прошлом. Укажите будущую дату.";
}

export function joinLimitBannedMessage() {
  return "Вы достигли лимита входов в основной чат через бота и пока не можете подавать анкеты и брони. Для возврата в чат обратитесь к администрации.";
}

export function manualBannedMessage() {
  return "Вы заблокированы (возможно, за нарушение правил) и не можете подавать анкеты и брони. Если считаете это ошибкой, обратитесь к администрации.";
}

export function alreadyMainChatMemberMessage() {
  return "Вы уже в основном чате — подавать анкету или бронь не нужно.";
}

export function roleValidationMessage(input: string, reason: "not_found" | "occupied" | "reserved" | "unknown") {
  const escaped = escapeHtml(input);
  const suffix = "\n\nВыберите свободную роль из списков ниже и напишите её название.";
  if (reason === "occupied") return `<b>Роль занята</b>\nРоль <code>${escaped}</code> уже занята.${suffix}`;
  if (reason === "reserved") return `<b>Роль забронирована</b>\nРоль <code>${escaped}</code> уже забронирована.${suffix}`;
  if (reason === "unknown") {
    return `<b>Не удалось проверить роль</b>\nРоль <code>${escaped}</code> не найдена в актуальном списке поста.${suffix}`;
  }
  return `<b>Роль не найдена</b>\nРоли <code>${escaped}</code> нет в списках.${suffix}`;
}

export function reservationMissingForExtensionMessage() {
  return "Бронь не найдена. Можно создать новую бронь через меню.";
}

export function reservationExtensionForbiddenMessage() {
  return "Эту бронь нельзя продлить из вашего аккаунта.";
}

export function reservationExtendedMessage(reservation: RoleReservationRecord, date: Date) {
  return `<b>Бронь продлена</b>\nРоль: <b>${escapeHtml(reservation.role_name)}</b>\nНовая дата: ${escapeHtml(formatDate(date))}`;
}

export function reservationExtendedAdminMessage(user: UserRecord, reservation: RoleReservationRecord, date: Date) {
  return `Пользователь ${user.telegram_id} продлил бронь #${reservation.id}: ${reservation.role_name} до ${formatDate(date)}.`;
}

export function applicationInviteCreationFailedAdminMessage(applicationId: number) {
  return `Не удалось создать invite-ссылку для анкеты #${applicationId}. Отправьте ссылку пользователю вручную.`;
}

export function applicationSubmittedMessage() {
  return "<b>Анкета отправлена</b>\nЯ напишу, когда администрация примет решение.";
}

export function reservationSubmittedMessage() {
  return "<b>Бронь отправлена</b>\nЯ напишу, когда администрация примет решение.";
}

export function waitlistSubmittedMessage() {
  return "<b>Бронь отправлена</b>\nНабор сейчас закрыт, поэтому бронь поставлена в очередь до появления места. Я напишу, когда администрация примет решение.";
}

export function subscriptionsFoundMessage() {
  return "Подписки найдены. Теперь выберите действие.";
}
