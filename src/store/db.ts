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

function migrateLegacyNames(db: Database.Database): void {
  if (tableExists(db, "godbound") && !tableExists(db, "heroes")) {
    db.exec("ALTER TABLE godbound RENAME TO heroes");
  }
}

function migrateLegacyColumns(db: Database.Database): void {
  if (tableExists(db, "factions") && columnExists(db, "factions", "patron_godbound_id")) {
    db.exec("ALTER TABLE factions RENAME COLUMN patron_godbound_id TO patron_hero_id");
  }
  if (tableExists(db, "change_commitments") && columnExists(db, "change_commitments", "godbound_id")) {
    db.exec("ALTER TABLE change_commitments RENAME COLUMN godbound_id TO hero_id");
  }
  if (tableExists(db, "court_dispositions")) {
    db.exec("UPDATE court_dispositions SET target_type = 'hero' WHERE target_type = 'godbound'");
  }
  if (tableExists(db, "unit_views")) {
    db.exec("UPDATE unit_views SET unit_type = 'hero' WHERE unit_type = 'godbound'");
  }
  if (tableExists(db, "write_queue")) {
    db.exec("UPDATE write_queue SET unit_type = 'hero' WHERE unit_type = 'godbound'");
  }
  if (tableExists(db, "actions")) {
    db.exec("UPDATE actions SET actor_type = 'hero' WHERE actor_type = 'godbound'");
    db.exec("UPDATE actions SET target_type = 'hero' WHERE target_type = 'godbound'");
  }
}

export function migrate(db: Database.Database): void {
  migrateLegacyNames(db);
  const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
  db.exec(readFileSync(schemaPath, "utf8"));
  migrateLegacyColumns(db);
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
