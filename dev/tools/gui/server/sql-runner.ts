import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";

export type SqlResult =
  | { columns: string[]; rows: unknown[][]; durationMs: number }
  | { text: string; durationMs: number };

export function resolveDbPath(repoRoot: string, dbPath: string): string {
  return path.isAbsolute(dbPath) ? dbPath : path.join(repoRoot, dbPath);
}

export function runSql(repoRoot: string, dbPath: string, sql: string): SqlResult {
  const started = Date.now();
  const resolved = resolveDbPath(repoRoot, dbPath);
  if (resolved !== ":memory:" && !existsSync(resolved)) {
    throw new Error("DB_NOT_FOUND");
  }
  const db = new Database(resolved, { fileMustExist: resolved !== ":memory:" });
  try {
    const trimmed = sql.trim();
    if (/^(select|pragma|with|explain)\b/i.test(trimmed)) {
      const stmt = db.prepare(trimmed);
      const rows = stmt.all() as Record<string, unknown>[];
      const durationMs = Date.now() - started;
      if (rows.length === 0) return { columns: [], rows: [], durationMs };
      const columns = Object.keys(rows[0]);
      return { columns, rows: rows.map((r) => columns.map((c) => r[c])), durationMs };
    }
    const stmt = db.prepare(trimmed);
    const info = stmt.run();
    return {
      text: JSON.stringify({ changes: info.changes, lastInsertRowid: String(info.lastInsertRowid) }),
      durationMs: Date.now() - started,
    };
  } finally {
    db.close();
  }
}
