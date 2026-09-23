import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { RuleError } from "../domain/types.js";

const STALE_MS = 30_000;
const memoryMutexes = new Map<string, symbol | null>();

function lockTimeoutMs(): number {
  const raw = process.env.GODBOUND_LOCK_TIMEOUT_MS;
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return 10_000;
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryReclaimStale(lockPath: string): boolean {
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    const [pidLine, tsLine] = raw.split(/\s+/);
    const pid = Number(pidLine);
    const ts = Number(tsLine);
    if (!Number.isFinite(pid) || !Number.isFinite(ts)) return false;
    if (Date.now() - ts < STALE_MS) return false;
    if (pidAlive(pid)) return false;
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function acquireFileLock(lockPath: string, deadline: number): void {
  let attempt = 1;
  while (Date.now() < deadline) {
    try {
      const payload = `${process.pid} ${Date.now()}\n`;
      writeFileSync(lockPath, payload, { flag: "wx" });
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      tryReclaimStale(lockPath);
      sleepSync(25 * attempt);
      attempt += 1;
    }
  }
  throw new RuleError("WRITE_LOCKED", "could not acquire write lock");
}

function releaseFileLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

function acquireMemoryLock(key: string, deadline: number): symbol {
  let attempt = 1;
  while (Date.now() < deadline) {
    if (!memoryMutexes.has(key) || memoryMutexes.get(key) == null) {
      const ticket = Symbol("lock");
      memoryMutexes.set(key, ticket);
      return ticket;
    }
    sleepSync(25 * attempt);
    attempt += 1;
  }
  throw new RuleError("WRITE_LOCKED", "could not acquire write lock");
}

function releaseMemoryLock(key: string, ticket: symbol): void {
  if (memoryMutexes.get(key) === ticket) {
    memoryMutexes.set(key, null);
  }
}

export function withWriteLock<T>(dbPath: string, fn: () => T): T {
  const deadline = Date.now() + lockTimeoutMs();
  if (dbPath === ":memory:") {
    const ticket = acquireMemoryLock(dbPath, deadline);
    try {
      return fn();
    } finally {
      releaseMemoryLock(dbPath, ticket);
    }
  }

  const lockPath = `${dbPath}.lock`;
  acquireFileLock(lockPath, deadline);
  try {
    return fn();
  } finally {
    releaseFileLock(lockPath);
  }
}
