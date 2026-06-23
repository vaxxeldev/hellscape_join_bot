import { callbackButton, inlineKeyboard, premiumEmoji, urlButton } from "./premiumEmoji.js";
import { applicationRejectReasons, buttonText, reservationRejectReasons } from "./texts.js";
export function mainMenuKeyboard(config) {
    return inlineKeyboard([
        [
            callbackButton(buttonText.submitApplication, "u:app", premiumEmoji.write, "primary"),
            callbackButton(buttonText.reserveRole, "u:res", premiumEmoji.clock, "primary"),
        ],
        [urlButton(buttonText.rules, config.rulesUrl, premiumEmoji.file), urlButton(buttonText.infoChannel, config.infoChannelUrl, premiumEmoji.info)],
        [urlButton(buttonText.lifeChannel, config.lifeChannelUrl, premiumEmoji.announcement), callbackButton(buttonText.help, "u:help", premiumEmoji.info)],
    ]);
}
export function missingSubscriptionsKeyboard(config, check) {
    const channelButtons = [];
    if (!check?.life)
        channelButtons.push(urlButton(buttonText.lifeChannel, config.lifeChannelUrl, premiumEmoji.announcement));
    if (!check?.info)
        channelButtons.push(urlButton(buttonText.infoChannel, config.infoChannelUrl, premiumEmoji.info));
    return inlineKeyboard([
        ...(channelButtons.length ? [channelButtons] : []),
        [callbackButton(buttonText.checkSubscription, "u:check", premiumEmoji.check, "success")],
    ]);
}
export function recruitmentClosedKeyboard() {
    return inlineKeyboard([[callbackButton(buttonText.reserveRole, "u:waitlist", premiumEmoji.clock, "primary")]]);
}
export function applicationRoleLinksKeyboard(config) {
    return inlineKeyboard([
        [
            urlButton("Genshin Impact", config.rolePostUrls.genshin, premiumEmoji.tag),
            urlButton("HSR", config.rolePostUrls.hsr, premiumEmoji.tag),
        ],
    ]);
}
export function confirmUsernameKeyboard() {
    return inlineKeyboard([[callbackButton(buttonText.confirm, "form:confirm_username", premiumEmoji.check, "success")]]);
}
export function codeRulesKeyboard(config) {
    return inlineKeyboard([[urlButton(buttonText.rules, config.rulesUrl, premiumEmoji.file, "primary")]]);
}
export function adminApplicationKeyboard(applicationId) {
    return inlineKeyboard([
        [
            callbackButton(buttonText.approve, `app:a:${applicationId}`, premiumEmoji.check, "success"),
            callbackButton(buttonText.reject, `app:r:${applicationId}`, premiumEmoji.cross, "danger"),
        ],
        [
            callbackButton(buttonText.recheckSubscriptions, `app:s:${applicationId}`, premiumEmoji.loading),
            callbackButton(buttonText.profile, `app:p:${applicationId}`, premiumEmoji.eye),
        ],
    ]);
}
export function applicationRejectReasonsKeyboard(applicationId) {
    return inlineKeyboard([
        [callbackButton(applicationRejectReasons.sub, `app:rr:${applicationId}:sub`, premiumEmoji.cross)],
        [callbackButton(applicationRejectReasons.code, `app:rr:${applicationId}:code`, premiumEmoji.lockClosed)],
        [callbackButton(applicationRejectReasons.bad, `app:rr:${applicationId}:bad`, premiumEmoji.file)],
        [callbackButton(applicationRejectReasons.risk, `app:rr:${applicationId}:risk`, premiumEmoji.userRejected)],
        [callbackButton(buttonText.other, `app:rr:${applicationId}:other`, premiumEmoji.pencil)],
    ]);
}
export function adminReservationKeyboard(reservationId) {
    return inlineKeyboard([
        [
            callbackButton(buttonText.approveReservation, `res:a:${reservationId}`, premiumEmoji.check, "success"),
            callbackButton(buttonText.reject, `res:r:${reservationId}`, premiumEmoji.cross, "danger"),
        ],
        [
            callbackButton(buttonText.recheckSubscriptions, `res:s:${reservationId}`, premiumEmoji.loading),
            callbackButton(buttonText.profile, `res:p:${reservationId}`, premiumEmoji.eye),
        ],
    ]);
}
export function reservationDueKeyboard(reservationId) {
    return inlineKeyboard([
        [
            callbackButton(buttonText.actual, `res:due:a:${reservationId}`, premiumEmoji.check, "success"),
            callbackButton(buttonText.notActual, `res:due:n:${reservationId}`, premiumEmoji.cross, "danger"),
        ],
        [callbackButton(buttonText.extendReservation, `res:due:e:${reservationId}`, premiumEmoji.clock, "primary")],
    ]);
}
export function waitlistDueKeyboard(reservationId) {
    return inlineKeyboard([
        [
            callbackButton(buttonText.actual, `res:due:a:${reservationId}`, premiumEmoji.check, "success"),
            callbackButton(buttonText.notActual, `res:due:n:${reservationId}`, premiumEmoji.cross, "danger"),
        ],
    ]);
}
export function reservationRejectReasonsKeyboard(reservationId) {
    return inlineKeyboard([
        [callbackButton(reservationRejectReasons.role, `res:rr:${reservationId}:role`, premiumEmoji.cross)],
        [callbackButton(reservationRejectReasons.long, `res:rr:${reservationId}:long`, premiumEmoji.clock)],
        [callbackButton(reservationRejectReasons.badrole, `res:rr:${reservationId}:badrole`, premiumEmoji.tag)],
        [callbackButton(reservationRejectReasons.risk, `res:rr:${reservationId}:risk`, premiumEmoji.userRejected)],
        [callbackButton(buttonText.other, `res:rr:${reservationId}:other`, premiumEmoji.pencil)],
    ]);
}
export function appealBanKeyboard() {
    return inlineKeyboard([[callbackButton(buttonText.appeal, "appeal:ban", premiumEmoji.notification, "primary")]]);
}
// "Связаться" opens the admin's chat with the user. Telegram only accepts a
// reliable url button via a t.me/<username> link, so it is added only when the
// user has a username; otherwise admins use the tappable mention in the text.
export function contactUserKeyboard(user) {
    if (!user.username)
        return undefined;
    return inlineKeyboard([
        [urlButton(buttonText.contact, `https://t.me/${user.username.replace(/^@/, "")}`, premiumEmoji.send, "success")],
    ]);
}
