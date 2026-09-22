import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function migrate(db: Database.Database): void {
  const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
  db.exec(readFileSync(schemaPath, "utf8"));
}

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  migrate(db);
  db.pragma("foreign_keys = ON");
  return db;
}

export function withTransaction<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(fn)();
}
