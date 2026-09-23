import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RuleError } from "../domain/types.js";

/** Schema this server writes. A higher user_version is a newer file. */
export const SCHEMA_VERSION = 2;
/** Lowest user_version this server can migrate. 0 is an unversioned v1 file. */
export const MIN_SCHEMA_VERSION = 0;

export function checkSchemaVersion(
  fileVersion: number,
  current = SCHEMA_VERSION,
  min = MIN_SCHEMA_VERSION,
): void {
  if (!Number.isInteger(fileVersion) || fileVersion < min || fileVersion > current) {
    throw new RuleError(
      "INCOMPATIBLE_SCHEMA",
      `campaign file schema ${fileVersion} is not compatible with this server (${min}–${current})`,
    );
  }
}

function schemaSql(): string {
  const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
  return readFileSync(schemaPath, "utf8");
}

function columnNames(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[];
  return new Set(rows.map((row) => row.name));
}

function migrateLegacyStrain(db: Database.Database): void {
  const challengeColumns = db.prepare("PRAGMA table_info(challenges)").all() as {
    name: string;
    notnull: number;
  }[];
  const changeId = challengeColumns.find((column) => column.name === "change_id");
  const hasCampaign = challengeColumns.some((column) => column.name === "campaign_id");
  if (changeId?.notnull === 1 || !hasCampaign) {
    db.exec(`
      CREATE TABLE challenges_next (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id),
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        change_id TEXT REFERENCES changes(id),
        status TEXT NOT NULL
      );
      INSERT INTO challenges_next (id, campaign_id, kind, text, change_id, status)
      SELECT c.id, ch.campaign_id, c.kind, c.text, c.change_id, c.status
      FROM challenges c
      JOIN changes ch ON ch.id = c.change_id;
      DROP TABLE challenges;
      ALTER TABLE challenges_next RENAME TO challenges;
    `);
  }

  const links: Array<[string, string]> = [
    ["court_id", "courts"],
    ["challenge_id", "challenges"],
    ["character_id", "characters"],
    ["fact_id", "facts"],
  ];
  const present = columnNames(db, "setpieces");
  for (const [column, parent] of links) {
    if (!present.has(column)) {
      db.exec(`ALTER TABLE setpieces ADD COLUMN ${column} TEXT REFERENCES ${parent}(id)`);
    }
  }
}

export function migrate(db: Database.Database, fileVersion = Number(db.pragma("user_version", { simple: true }))): void {
  if (fileVersion === SCHEMA_VERSION) return;
  const legacy = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'campaigns'")
    .get() as { ok: number } | undefined;
  db.pragma("foreign_keys = OFF");
  const apply = db.transaction(() => {
    if (!legacy) {
      db.exec(schemaSql());
    } else {
      migrateLegacyStrain(db);
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  });
  apply();
}

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  try {
    const fileVersion = Number(db.pragma("user_version", { simple: true }));
    checkSchemaVersion(fileVersion);
    migrate(db, fileVersion);
    db.pragma("foreign_keys = ON");
    if (path !== ":memory:") {
      db.pragma("journal_mode = WAL");
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export function withTransaction<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(fn)();
}
