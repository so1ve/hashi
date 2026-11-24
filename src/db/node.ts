import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { unixNow } from "../server/crypto.ts";
import type {
  CloseableSqlDatabase,
  SqlDatabase,
  SqlParam,
  SqlRunResult,
  SqlStatement,
} from "./index.ts";

export interface Migration {
  name: string;
  statements: readonly string[];
}

export const DEFAULT_MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  "../../migrations",
);

export const splitSqlStatements = (sql: string): string[] =>
  sql
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

export const loadMigrations = (
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): Migration[] =>
  fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      statements: splitSqlStatements(
        fs.readFileSync(path.join(migrationsDir, name), "utf8"),
      ),
    }));

export async function applyMigrations(
  db: SqlDatabase,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<string[]> {
  await db.run(
    `CREATE TABLE IF NOT EXISTS _hashi_migrations (
       name TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );

  const existing = await db.all<{ name: string }>(
    "SELECT name FROM _hashi_migrations",
  );
  const applied = new Set(existing.map((row) => row.name));
  const newlyApplied: string[] = [];

  for (const migration of loadMigrations(migrationsDir)) {
    if (applied.has(migration.name)) {
      continue;
    }
    await db.batch([
      ...migration.statements.map((sql) => ({ sql })),
      {
        sql: "INSERT INTO _hashi_migrations (name, applied_at) VALUES (?1, ?2)",
        params: [migration.name, unixNow()],
      },
    ]);
    newlyApplied.push(migration.name);
  }

  return newlyApplied;
}

export function openNodeSqlite(dbPath: string): CloseableSqlDatabase {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (dbPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }

  return {
    first: async <T>(sql: string, params: readonly SqlParam[] = []) =>
      (db.prepare(sql).get(...params) as T | undefined) ?? null,

    all: async <T>(sql: string, params: readonly SqlParam[] = []) =>
      db.prepare(sql).all(...params) as T[],

    run: async (sql: string, params: readonly SqlParam[] = []) => ({
      changes: Number(db.prepare(sql).run(...params).changes),
    }),

    async batch(
      statements: readonly SqlStatement[],
    ): Promise<readonly SqlRunResult[]> {
      if (statements.length === 0) {
        return [];
      }
      db.exec("BEGIN IMMEDIATE;");
      try {
        const results = statements.map((s) => ({
          changes: Number(db.prepare(s.sql).run(...(s.params ?? [])).changes),
        }));
        db.exec("COMMIT;");

        return results;
      } catch (error) {
        db.exec("ROLLBACK;");

        throw error;
      }
    },

    close: () => db.close(),
  };
}
