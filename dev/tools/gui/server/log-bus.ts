export type LogEvent = {
  ts: string;
  level: "info" | "error";
  direction: "mcp" | "sql" | "system";
  summary: string;
  detail?: string;
};

const MAX = 500;

export class LogBus {
  private events: LogEvent[] = [];
  private subs = new Set<(e: LogEvent) => void>();

  push(event: LogEvent): void {
    this.events.push(event);
    if (this.events.length > MAX) this.events.shift();
    for (const sub of this.subs) sub(event);
  }

  snapshot(): LogEvent[] {
    return [...this.events];
  }

  subscribe(fn: (e: LogEvent) => void): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }
}
