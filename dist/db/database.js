import BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger.js";
export class Database {
    db;
    constructor(databaseUrl) {
        const filePath = databaseUrl.startsWith("file:") ? databaseUrl.slice("file:".length) : databaseUrl;
        const resolvedPath = path.resolve(process.cwd(), filePath);
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        this.db = new BetterSqlite3(resolvedPath, { timeout: 5000 });
        this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
    `);
        this.applyMigrations();
    }
    query(sql, params = {}) {
        return this.db.prepare(sql).all(params);
    }
    get(sql, params = {}) {
        return this.db.prepare(sql).get(params);
    }
    run(sql, params = {}) {
        return this.db.prepare(sql).run(params);
    }
    transaction(fn) {
        return this.db.transaction(fn)();
    }
    close() {
        this.db.close();
    }
    applyMigrations() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
        const migrationsDir = path.resolve(process.cwd(), "migrations");
        const files = fs
            .readdirSync(migrationsDir)
            .filter((file) => file.endsWith(".sql"))
            .sort();
        for (const file of files) {
            const existing = this.get("SELECT filename FROM migrations WHERE filename = :filename", { filename: file });
            if (existing)
                continue;
            const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
            this.transaction(() => {
                this.db.exec(sql);
                this.run("INSERT INTO migrations (filename) VALUES (:filename)", { filename: file });
            });
            logger.info({ migration: file }, "migration applied");
        }
    }
}
