import { escapeHtml } from "../utils/text.js";
import { adminTitleText } from "../bot/texts.js";
export function isAdmin(config, telegramId) {
    return typeof telegramId === "number" && config.adminIds.has(telegramId);
}
export function adminTitle(config, telegramId) {
    if (telegramId === config.developerId)
        return adminTitleText.developer;
    if (telegramId === config.ownerId)
        return adminTitleText.owner;
    if (config.coOwnerIds.includes(telegramId))
        return adminTitleText.coOwner;
    if (config.seniorAdminIds.includes(telegramId))
        return adminTitleText.senior;
    if (config.juniorAdminIds.includes(telegramId))
        return adminTitleText.junior;
    return adminTitleText.admin;
}
export function adminDisplay(config, user) {
    const title = adminTitle(config, user.id);
    const name = user.username
        ? `@${user.username}`
        : [user.first_name, user.last_name].filter(Boolean).join(" ") || `ID ${user.id}`;
    return `${title} ${escapeHtml(name)} <code>${user.id}</code>`;
}
