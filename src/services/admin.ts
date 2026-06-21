import type { AppConfig } from "../config/env.js";
import { escapeHtml } from "../utils/text.js";
import { adminTitleText } from "../bot/texts.js";

export function isAdmin(config: AppConfig, telegramId: number | undefined) {
  return typeof telegramId === "number" && config.adminIds.has(telegramId);
}

export function adminTitle(config: AppConfig, telegramId: number) {
  if (telegramId === config.developerId) return adminTitleText.developer;
  if (telegramId === config.ownerId) return adminTitleText.owner;
  if (config.coOwnerIds.includes(telegramId)) return adminTitleText.coOwner;
  if (config.seniorAdminIds.includes(telegramId)) return adminTitleText.senior;
  if (config.juniorAdminIds.includes(telegramId)) return adminTitleText.junior;
  return adminTitleText.admin;
}

export function adminDisplay(
  config: AppConfig,
  user: { id: number; username?: string; first_name?: string; last_name?: string },
) {
  const title = adminTitle(config, user.id);
  const name = user.username
    ? `@${user.username}`
    : [user.first_name, user.last_name].filter(Boolean).join(" ") || `ID ${user.id}`;
  return `${title} ${escapeHtml(name)} <code>${user.id}</code>`;
}
