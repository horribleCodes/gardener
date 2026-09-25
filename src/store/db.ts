import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { ok: number } | undefined;
  return row != null;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}


export function migrate(db: Database.Database): void {
  const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
  db.exec(readFileSync(schemaPath, "utf8"));
  // TODO: Implement generic migration logic for module upgrades (blocked by module architecture)
}

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  migrate(db);
  db.pragma("foreign_keys = ON");
  if (path !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  return db;
}

export function withTransaction<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(fn)();
}
