import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger.js";
const roleFiles = {
    genshin: "roles genshin.txt",
    hsr: "roles hsr.txt",
};
const occupiedRoleMarker = "🧪";
export class RoleService {
    repos;
    getConfig;
    cachePath = path.resolve(process.cwd(), "data", "role_posts_cache.json");
    aliasMap = this.loadAliases();
    roles = this.loadRoles();
    postCache = {};
    constructor(repos, getConfig) {
        this.repos = repos;
        this.getConfig = getConfig;
        this.postCache = this.readPostCache();
    }
    async checkRole(input) {
        const role = this.findRole(input);
        if (!role)
            return { ok: false, reason: "not_found" };
        const localStatus = this.localClaimStatus(role);
        if (localStatus === "occupied")
            return { ok: false, reason: "occupied", role: role.canonical };
        if (localStatus === "reserved")
            return { ok: false, reason: "reserved", role: role.canonical };
        const postStatus = await this.postRoleStatus(role);
        if (postStatus === "free")
            return { ok: true, role: role.canonical };
        return { ok: false, reason: postStatus, role: role.canonical };
    }
    catalogStats() {
        return {
            total: this.roles.length,
            genshin: this.roles.filter((role) => role.universe === "genshin").length,
            hsr: this.roles.filter((role) => role.universe === "hsr").length,
        };
    }
    loadRoles() {
        return Object.entries(roleFiles).flatMap(([universe, file]) => {
            const filePath = path.resolve(process.cwd(), "roles", file);
            const lines = fs
                .readFileSync(filePath, "utf8")
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            return lines.map((canonical) => ({
                canonical,
                aliases: [canonical, ...(this.aliasMap[normalizeRole(canonical)] ?? [])],
                universe,
            }));
        });
    }
    loadAliases() {
        const filePath = path.resolve(process.cwd(), "roles", "aliases.json");
        try {
            if (!fs.existsSync(filePath))
                return {};
            const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
            return Object.fromEntries(Object.entries(raw).map(([role, aliases]) => [
                normalizeRole(role),
                Array.isArray(aliases) ? aliases.filter((alias) => typeof alias === "string") : [],
            ]));
        }
        catch (error) {
            logger.warn({ error, filePath }, "failed to load role aliases");
            return {};
        }
    }
    findRole(input) {
        const normalized = normalizeRole(input);
        return this.roles.find((role) => role.aliases.some((alias) => normalizeRole(alias) === normalized));
    }
    localClaimStatus(role) {
        const roleKey = normalizeRole(role.canonical);
        const applicationClaim = this.repos
            .listApplications(500)
            .find((app) => ["approved", "joined"].includes(app.status) && normalizeRole(app.role) === roleKey);
        if (applicationClaim)
            return "occupied";
        const reservationClaim = this.repos
            .listReservations(["pending", "approved"], 500)
            .find((reservation) => normalizeRole(reservation.role_name) === roleKey);
        return reservationClaim ? "reserved" : "free";
    }
    async postRoleStatus(role) {
        const html = await this.getPostHtml(role.universe);
        if (!html)
            return "unknown";
        const underlined = underlinedRoleNames(html);
        if (role.aliases.some((alias) => underlined.has(normalizeRole(alias))))
            return "occupied";
        const text = postPlainText(html);
        const matches = allRoleMatches(text, this.roles.filter((item) => item.universe === role.universe));
        const roleKeys = new Set(role.aliases.map(normalizeRole));
        const match = matches.find((item) => roleKeys.has(item.key));
        if (!match)
            return "unknown";
        // Границу сегмента ищем по ближайшему тире в тексте, а не по следующей
        // РАСПОЗНАННОЙ роли: если имя между текущей ролью и следующей не совпало
        // ни с одним алиасом (опечатка, сокращение в посте), её маркер занятости
        // не должен утекать в статус текущей роли.
        const nextDashIndex = nextDashIndexAfter(text, match.end);
        const segment = text.slice(match.end, nextDashIndex ?? text.length);
        if (segment.includes(occupiedRoleMarker))
            return "occupied";
        if (/@[a-zA-Z0-9_]{3,}/.test(segment))
            return "reserved";
        return "free";
    }
    async getPostHtml(universe) {
        const cached = this.postCache[universe];
        if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000)
            return cached.html;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 7000);
            const response = await fetch(telegramEmbedUrl(this.getConfig().rolePostUrls[universe]), { signal: controller.signal });
            clearTimeout(timeout);
            if (!response.ok)
                throw new Error(`Telegram returned ${response.status}`);
            const html = await response.text();
            this.postCache[universe] = { fetchedAt: Date.now(), html };
            this.writePostCache();
            return html;
        }
        catch (error) {
            logger.warn({ error, universe }, "failed to fetch role post, using cached copy");
            return cached?.html ?? null;
        }
    }
    readPostCache() {
        try {
            if (!fs.existsSync(this.cachePath))
                return {};
            return JSON.parse(fs.readFileSync(this.cachePath, "utf8"));
        }
        catch (error) {
            logger.warn({ error }, "failed to read role post cache");
            return {};
        }
    }
    writePostCache() {
        try {
            fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
            fs.writeFileSync(this.cachePath, JSON.stringify(this.postCache), "utf8");
        }
        catch (error) {
            logger.warn({ error }, "failed to write role post cache");
        }
    }
}
export function allRoleMatches(text, roles) {
    return roles
        .flatMap((role) => role.aliases.flatMap((alias) => {
        const expression = new RegExp(`${escapeRegex(alias)}\\s*[-–—]`, "giu");
        return [...text.matchAll(expression)].map((match) => ({
            index: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
            key: normalizeRole(alias),
        }));
    }))
        .sort((a, b) => a.index - b.index || b.end - a.end);
}
export function underlinedRoleNames(html) {
    const body = messageBodyHtml(html) ?? html;
    return new Set([...body.matchAll(/<u>(.*?)<\/u>/gis)]
        .map((match) => stripTags(decodeHtml(match[1] ?? "")))
        .map(normalizeRole)
        .filter(Boolean));
}
function messageBodyHtml(html) {
    return /<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div><\/div><div class="media_not_supported_cont">/i.exec(html)?.[1];
}
export function postPlainText(html) {
    const message = messageBodyHtml(html);
    return stripTags(decodeHtml((message ?? html).replace(/<br\s*\/?>/gi, " ").replace(/<tg-emoji[\s\S]*?<\/tg-emoji>/gi, (value) => {
        const emoji = /<b>(.*?)<\/b>/i.exec(value)?.[1];
        return emoji ? decodeHtml(emoji) : ` ${occupiedRoleMarker} `;
    }))).replace(/\s+/g, " ");
}
export function nextDashIndexAfter(text, fromIndex) {
    const relativeIndex = text.slice(fromIndex).search(/[-–—]/);
    return relativeIndex === -1 ? null : fromIndex + relativeIndex;
}
function stripTags(value) {
    return value.replace(/<[^>]+>/g, " ");
}
function decodeHtml(value) {
    return value
        .replace(/&nbsp;/g, " ")
        .replace(/&#33;/g, "!")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}
export function normalizeRole(value) {
    return value
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[._()[\]{}'"`«»]/g, "")
        .replace(/[–—-]/g, " ")
        .replace(/\s*\/\s*/g, "/")
        .replace(/\s+/g, " ")
        .trim();
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}
function telegramEmbedUrl(value) {
    const url = new URL(value);
    url.searchParams.set("embed", "1");
    return url.toString();
}
