import type { UserRecord } from "../types.js";

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function normalizeCodeWord(value: string) {
  return value
    .trim()
    .replace(/^[\s.,!?;:()[\]{}"«»'`]+|[\s.,!?;:()[\]{}"«»'`]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function boolMark(value: boolean | number) {
  return value ? "✅" : "❌";
}

export function formatName(user: UserRecord | { first_name?: string | null; last_name?: string | null }) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || "без имени";
}

export function profileLink(user: UserRecord) {
  if (user.username) return `https://t.me/${user.username}`;
  return `tg://user?id=${user.telegram_id}`;
}

export function mentionUser(user: UserRecord) {
  return `<a href="${escapeHtml(profileLink(user))}">${escapeHtml(formatName(user))}</a>`;
}

export function usernameOrDash(value: string | null | undefined) {
  return value ? `@${value.replace(/^@/, "")}` : "не указан";
}
