import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/env.js";
import type { Repositories } from "../db/repositories.js";
import { logger } from "../utils/logger.js";

type RoleUniverse = "genshin" | "hsr";
type RoleStatus = "free" | "occupied" | "reserved" | "unknown";

type RoleEntry = {
  canonical: string;
  aliases: string[];
  universe: RoleUniverse;
};

type RoleCheckResult =
  | { ok: true; role: string }
  | { ok: false; reason: "not_found" | "occupied" | "reserved" | "unknown"; role?: string };

const roleFiles: Record<RoleUniverse, string> = {
  genshin: "roles genshin.txt",
  hsr: "roles hsr.txt",
};

export class RoleService {
  private readonly cachePath = path.resolve(process.cwd(), "data", "role_posts_cache.json");
  private readonly aliasMap = this.loadAliases();
  private readonly roles = this.loadRoles();
  private postCache: Partial<Record<RoleUniverse, { fetchedAt: number; html: string }>> = {};

  constructor(
    private readonly repos: Repositories,
    private readonly getConfig: () => AppConfig,
  ) {
    this.postCache = this.readPostCache();
  }

  async checkRole(input: string): Promise<RoleCheckResult> {
    const role = this.findRole(input);
    if (!role) return { ok: false, reason: "not_found" };

    const localStatus = this.localClaimStatus(role);
    if (localStatus === "occupied") return { ok: false, reason: "occupied", role: role.canonical };
    if (localStatus === "reserved") return { ok: false, reason: "reserved", role: role.canonical };

    const postStatus = await this.postRoleStatus(role);
    if (postStatus === "free") return { ok: true, role: role.canonical };
    return { ok: false, reason: postStatus, role: role.canonical };
  }

  private loadRoles() {
    return (Object.entries(roleFiles) as Array<[RoleUniverse, string]>).flatMap(([universe, file]) => {
      const filePath = path.resolve(process.cwd(), "roles", file);
      const lines = fs
        .readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      return lines.map<RoleEntry>((canonical) => ({
        canonical,
        aliases: [canonical, ...(this.aliasMap[normalizeRole(canonical)] ?? [])],
        universe,
      }));
    });
  }

  private loadAliases() {
    const filePath = path.resolve(process.cwd(), "roles", "aliases.json");
    try {
      if (!fs.existsSync(filePath)) return {} as Record<string, string[]>;
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, string[]>;
      return Object.fromEntries(
        Object.entries(raw).map(([role, aliases]) => [
          normalizeRole(role),
          Array.isArray(aliases) ? aliases.filter((alias) => typeof alias === "string") : [],
        ]),
      );
    } catch (error) {
      logger.warn({ error, filePath }, "failed to load role aliases");
      return {} as Record<string, string[]>;
    }
  }

  private findRole(input: string) {
    const normalized = normalizeRole(input);
    return this.roles.find((role) => role.aliases.some((alias) => normalizeRole(alias) === normalized));
  }

  private localClaimStatus(role: RoleEntry): RoleStatus {
    const roleKey = normalizeRole(role.canonical);
    const applicationClaim = this.repos
      .listApplications(500)
      .find((app) => ["approved", "joined"].includes(app.status) && normalizeRole(app.role) === roleKey);
    if (applicationClaim) return "occupied";

    const reservationClaim = this.repos
      .listReservations(["pending", "approved"], 500)
      .find((reservation) => normalizeRole(reservation.role_name) === roleKey);
    return reservationClaim ? "reserved" : "free";
  }

  private async postRoleStatus(role: RoleEntry): Promise<RoleStatus> {
    const html = await this.getPostHtml(role.universe);
    if (!html) return "unknown";

    const underlined = underlinedRoleNames(html);
    if (role.aliases.some((alias) => underlined.has(normalizeRole(alias)))) return "occupied";

    const text = postPlainText(html);
    const matches = allRoleMatches(text, this.roles.filter((item) => item.universe === role.universe));
    const roleKeys = new Set(role.aliases.map(normalizeRole));
    const match = matches.find((item) => roleKeys.has(item.key));
    if (!match) return "unknown";

    const segment = text.slice(match.end, matches.find((item) => item.index > match.index)?.index ?? text.length);
    if (segment.includes("💎")) return "occupied";
    if (/@[a-zA-Z0-9_]{3,}/.test(segment)) return "reserved";
    return "free";
  }

  private async getPostHtml(universe: RoleUniverse) {
    const cached = this.postCache[universe];
    if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) return cached.html;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const response = await fetch(telegramEmbedUrl(this.getConfig().rolePostUrls[universe]), { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
      const html = await response.text();
      this.postCache[universe] = { fetchedAt: Date.now(), html };
      this.writePostCache();
      return html;
    } catch (error) {
      logger.warn({ error, universe }, "failed to fetch role post, using cached copy");
      return cached?.html ?? null;
    }
  }

  private readPostCache() {
    try {
      if (!fs.existsSync(this.cachePath)) return {};
      return JSON.parse(fs.readFileSync(this.cachePath, "utf8")) as Partial<
        Record<RoleUniverse, { fetchedAt: number; html: string }>
      >;
    } catch (error) {
      logger.warn({ error }, "failed to read role post cache");
      return {};
    }
  }

  private writePostCache() {
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify(this.postCache), "utf8");
    } catch (error) {
      logger.warn({ error }, "failed to write role post cache");
    }
  }
}

function allRoleMatches(text: string, roles: RoleEntry[]) {
  return roles
    .flatMap((role) =>
      role.aliases.flatMap((alias) => {
        const expression = new RegExp(`${escapeRegex(alias)}\\s*[-–—]`, "giu");
        return [...text.matchAll(expression)].map((match) => ({
          index: match.index ?? 0,
          end: (match.index ?? 0) + match[0].length,
          key: normalizeRole(alias),
        }));
      }),
    )
    .sort((a, b) => a.index - b.index || b.end - a.end);
}

function underlinedRoleNames(html: string) {
  return new Set(
    [...html.matchAll(/<u>(.*?)<\/u>/gis)]
      .map((match) => stripTags(decodeHtml(match[1] ?? "")))
      .map(normalizeRole)
      .filter(Boolean),
  );
}

function postPlainText(html: string) {
  const message = /<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div><\/div><div class="media_not_supported_cont">/i.exec(
    html,
  )?.[1];
  return stripTags(
    decodeHtml((message ?? html).replace(/<br\s*\/?>/gi, " ").replace(/<tg-emoji[\s\S]*?<\/tg-emoji>/gi, (value) => {
      const emoji = /<b>(.*?)<\/b>/i.exec(value)?.[1];
      return emoji ? decodeHtml(emoji) : " 💎 ";
    })),
  ).replace(/\s+/g, " ");
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&#33;/g, "!")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function normalizeRole(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[._()[\]{}'"`«»]/g, "")
    .replace(/[–—-]/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function telegramEmbedUrl(value: string) {
  const url = new URL(value);
  url.searchParams.set("embed", "1");
  return url.toString();
}
