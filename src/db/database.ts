import BetterSqlite3 from "better-sqlite3";
import type { Database as SqliteDatabase, RunResult } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger.js";

type SQLInputValue = string | number | bigint | Buffer | null;

export class Database {
  private readonly db: SqliteDatabase;

  constructor(databaseUrl: string) {
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

  query<T>(sql: string, params: Record<string, SQLInputValue> = {}) {
    return this.db.prepare(sql).all(params) as T[];
  }

  get<T>(sql: string, params: Record<string, SQLInputValue> = {}) {
    return this.db.prepare(sql).get(params) as T | undefined;
  }

  run(sql: string, params: Record<string, SQLInputValue> = {}): RunResult {
    return this.db.prepare(sql).run(params);
  }

  transaction<T>(fn: () => T) {
    return this.db.transaction(fn)();
  }

  close() {
    this.db.close();
  }

  private applyMigrations() {
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
      const existing = this.get<{ filename: string }>(
        "SELECT filename FROM migrations WHERE filename = :filename",
        { filename: file },
      );
      if (existing) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      this.transaction(() => {
        this.db.exec(sql);
        this.run("INSERT INTO migrations (filename) VALUES (:filename)", { filename: file });
      });
      logger.info({ migration: file }, "migration applied");
    }
  }
}
