import { expect, test } from "vitest";
import { appendLogEvent, initialLogDrawer, toggleLogDrawer } from "../../dev/tools/gui/client/log-drawer.js";

test("starts expanded with no events", () => {
  expect(initialLogDrawer()).toEqual({ collapsed: false, events: [] });
});

test("collapse and expand keep the same events array", () => {
  const state = { collapsed: false, events: ["a"] };
  const collapsed = toggleLogDrawer(state);
  expect(collapsed.collapsed).toBe(true);
  expect(collapsed.events).toBe(state.events);
  const expanded = toggleLogDrawer(collapsed);
  expect(expanded.collapsed).toBe(false);
  expect(expanded.events).toBe(state.events);
});

test("an event that arrives while collapsed stays collapsed and keeps earlier events", () => {
  const collapsed = toggleLogDrawer({ collapsed: false, events: ["a"] });
  const next = appendLogEvent(collapsed, "b");
  expect(next.collapsed).toBe(true);
  expect(next.events).toEqual(["a", "b"]);
  expect(collapsed.events).toEqual(["a"]);
});
