import { describe, expect, test } from "vitest";
import { LogBus, type LogEvent } from "../../dev/tools/gui/server/log-bus.js";

function event(summary: string): LogEvent {
  return {
    ts: "2026-01-01T00:00:00.000Z",
    level: "info",
    direction: "system",
    summary,
  };
}

describe("LogBus", () => {
  test("snapshot returns pushed events in order", () => {
    const bus = new LogBus();
    bus.push(event("a"));
    bus.push(event("b"));
    expect(bus.snapshot().map((e) => e.summary)).toEqual(["a", "b"]);
  });

  test("drops oldest events after 500", () => {
    const bus = new LogBus();
    for (let i = 0; i < 501; i++) bus.push(event(String(i)));
    const snap = bus.snapshot();
    expect(snap).toHaveLength(500);
    expect(snap[0].summary).toBe("1");
    expect(snap[499].summary).toBe("500");
  });

  test("subscribe receives new events and unsubscribe stops them", () => {
    const bus = new LogBus();
    const seen: string[] = [];
    const unsub = bus.subscribe((e) => seen.push(e.summary));
    bus.push(event("one"));
    unsub();
    bus.push(event("two"));
    expect(seen).toEqual(["one"]);
  });
});
