export function nowIso() {
    return new Date().toISOString();
}
export function addHours(date, hours) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
}
export function toUnixSeconds(date) {
    return Math.floor(date.getTime() / 1000);
}
export function isPastIso(value) {
    return new Date(value).getTime() <= Date.now();
}
export function parseUserDate(input) {
    const trimmed = input.trim();
    const match = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(trimmed);
    if (!match)
        return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) {
        return null;
    }
    return date;
}
export function formatDate(value) {
    if (!value)
        return "не указано";
    return new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(typeof value === "string" ? new Date(value) : value);
}
