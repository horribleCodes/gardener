import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runSql } from "../../dev/tools/gui/server/sql-runner.js";

describe("runSql", () => {
  test("returns columns and rows for SELECT", () => {
    const dir = mkdtempSync(join(tmpdir(), "gui-sql-"));
    const dbPath = join(dir, "campaign.sqlite");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE campaigns (id TEXT, name TEXT)");
    db.prepare("INSERT INTO campaigns VALUES (?, ?)").run("c1", "Kistelek");
    db.close();

    const result = runSql(dir, dbPath, "SELECT id, name FROM campaigns");
    expect(result).toMatchObject({
      columns: ["id", "name"],
      rows: [["c1", "Kistelek"]],
    });
    expect("durationMs" in result && typeof result.durationMs === "number").toBe(true);
  });

  test("returns text for non-select statements", () => {
    const dir = mkdtempSync(join(tmpdir(), "gui-sql-"));
    const dbPath = join(dir, "campaign.sqlite");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE t (n INTEGER)");
    db.close();

    const result = runSql(dir, dbPath, "INSERT INTO t (n) VALUES (1)");
    expect(result).toHaveProperty("text");
  });

  test("throws a clear error when the database file is missing", () => {
    expect(() => runSql("/tmp", join("/tmp", "no-such-gardener.sqlite"), "SELECT 1")).toThrow(
      /DB_NOT_FOUND|ENOENT|no such file/i,
    );
  });
});
