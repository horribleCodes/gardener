import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { access } from "node:fs/promises";
import path from "node:path";
import type { LogBus } from "./log-bus.js";
import { resolveDbPath } from "./sql-runner.js";

export type McpStatus =
  | { status: "stopped"; dbPath: string }
  | { status: "connecting"; dbPath: string }
  | { status: "connected"; dbPath: string; serverVersion: { name: string; version: string } };

function stringEnv(dbPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.GARDENER_WORLD_DB = dbPath;
  return env;
}

export class McpSession {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private starting = false;
  private stderrTail = "";

  constructor(
    private readonly repoRoot: string,
    private dbPath: string,
    private readonly log: LogBus,
  ) {}

  setDbPath(p: string): void {
    if (this.client || this.starting) throw new Error("MCP_RUNNING");
    this.dbPath = p;
  }

  getDbPath(): string {
    return this.dbPath;
  }

  getStatus(): McpStatus {
    if (this.client) {
      return {
        status: "connected",
        dbPath: this.dbPath,
        serverVersion: this.client.getServerVersion() ?? { name: "gardener", version: "?" },
      };
    }
    if (this.starting) return { status: "connecting", dbPath: this.dbPath };
    return { status: "stopped", dbPath: this.dbPath };
  }

  async start(): Promise<McpStatus> {
    if (this.client) return this.getStatus();
    if (this.starting) return this.getStatus();
    const script = path.join(this.repoRoot, "dist/server.js");
    try {
      await access(script);
    } catch {
      throw new Error("BUILD_REQUIRED");
    }
    this.starting = true;
    const resolvedDb = resolveDbPath(this.repoRoot, this.dbPath);
    try {
      this.transport = new StdioClientTransport({
        command: process.execPath,
        args: [script],
        cwd: this.repoRoot,
        env: stringEnv(resolvedDb),
        stderr: "pipe",
      });
      const stderr = this.transport.stderr;
      this.stderrTail = "";
      if (stderr && "on" in stderr) {
        stderr.on("data", (chunk: Buffer | string) => {
          const text = String(chunk);
          this.stderrTail = (this.stderrTail + text).slice(-4000);
          this.log.push({
            ts: new Date().toISOString(),
            level: "info",
            direction: "system",
            summary: "MCP stderr",
            detail: text.trim(),
          });
        });
      }
      this.transport.onclose = () => {
        if (this.client) {
          this.log.push({
            ts: new Date().toISOString(),
            level: "error",
            direction: "system",
            summary: "MCP child closed unexpectedly",
            detail: this.stderrTail || undefined,
          });
        }
        this.client = null;
        this.transport = null;
        this.starting = false;
      };
      this.client = new Client({ name: "gardener-dev-gui", version: "0.1.0" });
      await this.client.connect(this.transport);
      this.starting = false;
      this.log.push({
        ts: new Date().toISOString(),
        level: "info",
        direction: "system",
        summary: "MCP connected",
        detail: resolvedDb,
      });
      return this.getStatus();
    } catch (error) {
      this.client = null;
      this.transport = null;
      this.log.push({
        ts: new Date().toISOString(),
        level: "error",
        direction: "system",
        summary: "MCP start failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.starting = false;
    }
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = null;
    try {
      await client?.close();
    } catch {
      // ignore close races
    }
    this.transport = null;
    this.log.push({
      ts: new Date().toISOString(),
      level: "info",
      direction: "system",
      summary: "MCP stopped",
    });
  }

  withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    if (!this.client) throw new Error("MCP_NOT_RUNNING");
    const run = () => fn(this.client!);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }
}
