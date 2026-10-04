import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolveDbPath } from "./sql-runner.js";

export type CampaignRow = { id: string; name: string };

export function listCampaigns(repoRoot: string, dbPath: string): CampaignRow[] {
  const resolved = resolveDbPath(repoRoot, dbPath);
  if (resolved !== ":memory:" && !existsSync(resolved)) return [];
  const db = new Database(resolved, { fileMustExist: resolved !== ":memory:" });
  try {
    db.pragma("busy_timeout = 500");
    const table = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'campaigns'")
      .get() as { ok: number } | undefined;
    if (!table) return [];
    return db.prepare("SELECT id, name FROM campaigns ORDER BY name COLLATE NOCASE, id").all() as CampaignRow[];
  } finally {
    db.close();
  }
}
