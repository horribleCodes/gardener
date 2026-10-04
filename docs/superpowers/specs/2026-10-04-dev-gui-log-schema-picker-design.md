# Dev GUI: collapsible traffic log, schema fill, campaign picker

> Status: design for [issue #78](https://github.com/horribleCodes/gardener/issues/78). Dev GUI only. Does not change MCP tools, campaign create/delete, schema, or `src/`.

## Purpose

Make the localhost Dev GUI faster for bulk tool calls and campaign targeting, and let the traffic log get out of the way without losing the session.

Issue #78 already decided:

- The traffic log panel is collapsible, and collapsing it does not drop the session log.
- Tool text areas get a button that replaces the text with a JSON object of every object and field the schema defines.
- Campaign ids and names load in the background and do not block the main GUI.
- Every campaign-id input offers a dropdown of that list (id and name).

Out of scope for the issue, and for this spec: campaign create/delete behavior, and schema or seed tools outside this GUI.

## Success criteria

| Criterion | How we know |
| --- | --- |
| Collapse keeps the log | Toggling the traffic log hides the lines and the filters. The client events array is the same array as before the toggle, and the server ring buffer is untouched. The `EventSource` stays open. Expanding shows those events, including any that arrived while collapsed. |
| Schema fill | With a tool selected, **Fill from schema** replaces `#tool-json` with pretty-printed JSON that contains every property in that tool’s `inputSchema`, including nested objects and one exemplar array element. |
| Campaign list is background work | `boot()` and tab mounts do not await `GET /api/campaigns`. The tools list still loads as it does today. |
| Campaign dropdown | Every text input whose name is `campaignId` shows a menu of `name — id`. Choosing a row sets the input’s value to the id. A typed id still works when the list is empty. |

## Non-goals

- A new MCP tool, resource, or prompt, including a campaign-list tool.
- Changes under `src/`, `user/`, or `docs/design/`.
- Changing `collectArgs` (form fields still overlay the JSON textarea on Call).
- Auto-filling the JSON textarea when a tool is selected.
- Persisting the collapsed flag across page reload.
- A dropdown inside the JSON textarea for nested `campaignId` keys.
- SQL textarea, prompt text, or any control whose name is not exactly `campaignId`.
- New runtime dependencies. Tests stay on Vitest’s node environment.

## Context

The GUI lives under `dev/tools/gui/`. The browser is Vite + vanilla TypeScript. The API is a Node HTTP server on `127.0.0.1:3847`.

Today:

- `#log-drawer` is always visible (`client/index.html`, `client/main.ts`, `client/styles.css`). The client keeps `logEvents` and renders from the SSE stream at `/api/logs`. The server `LogBus` keeps the last 500 events and replays them when a client connects (`server/log-bus.ts`, `server/http.ts`).
- The Tools tab has one arguments textarea, `#tool-json`, plus primitive form fields for top-level strings, numbers, booleans, and enums (`client/tabs/tools.ts`). Nested values are edited in that textarea. `listTools` returns JSON Schema produced by the MCP SDK’s Zod converter: optional fields are properties omitted from `required` (they are not `anyOf` null), enums are `type: "string"` plus `enum`, integers carry `minimum` / `maximum`, arrays carry `items`, and `z.record` is an object with `additionalProperties` and no `properties`.
- `campaignId` is a top-level string on most tools, a `{campaignId}` URI parameter on every `world://` template (`client/tabs/resources.ts`), and a prompt argument (`client/tabs/prompts.ts`). There is no list-campaigns tool. Campaign rows are `campaigns.id` and `campaigns.name` in the SQLite file (`src/store/schema.sql`). The GUI already opens that file with a short-lived `better-sqlite3` connection in `runSql`.

## Approaches

### Traffic log

**A. Toggle a class; keep the event array and the EventSource. Chosen.**

The header stays. A button hides `.log-lines` and `.filters`. State changes go through a tiny pure module so a test can show that collapse returns the same events array and that an append while collapsed keeps the collapsed flag and the previous events. The DOM click handler only calls that module and updates classes.

**B. Tear down the log DOM and reopen SSE on expand.** Reconnect would replay the server snapshot, and events are easy to drop if the client array is cleared at the same time. The issue requires the session log to survive collapse.

**C. Remember collapsed in `localStorage`.** The issue does not ask for that. Reload starts expanded. Events still return from the server snapshot when the API process is up.

### Schema fill

**A. Build the JSON in the browser from the tool `inputSchema` already on the selected tool. Chosen.**

No extra request. The button replaces the textarea text. The same schema object the form already renders is the source.

**B. Add a server route that returns an example.** The browser already has the schema. A second route would duplicate it.

**C. Emit only `required` fields.** That omits optional objects and fields the issue asked to include.

### Campaign list

**A. `GET /api/campaigns` reads SQLite on a short-lived connection, and the browser fetches it without awaiting. Chosen.**

The main GUI paints even when the file is missing or the query is slow. The request does not take the MCP session mutex and does not require Start MCP. Missing file and missing `campaigns` table are an empty list, not an alert.

**B. Have the browser `POST /api/sql`.** That writes a traffic-log line per fetch, and a missing file is HTTP 400 `DB_NOT_FOUND`. The picker would have to swallow that error, and the SQL console would show the poll.

**C. Add an MCP list tool.** Issue #78 leaves schema and seed tools outside this GUI. An MCP call would also wait on the stdio mutex and on Start MCP, which blocks the dropdown on the thing the GUI is trying not to block on.

### Dropdown widget

**A. Keep the text input. On focus, show a listbox whose rows are `name — id`. Chosen.**

The submitted value is the id. The row text shows both. Typed text remains, including before the list arrives. The menu renders the current list immediately and refreshes it when a background fetch finishes.

**B. `<datalist>`.** The value can be the id, but browsers do not agree on whether the option label is visible. The issue asks for id and name on the dropdown.

**C. Replace the input with `<select>`.** An id that is not in the loaded list cannot be typed. Create-then-use and paste both need a free-text input.

## Design

### Collapsible traffic log

`#log-drawer` gains a **Collapse** / **Expand** button (`#log-toggle`, `type="button"`) in the header, next to the “Traffic log” title. `aria-expanded` is `true` while the lines are shown. `aria-controls="log-lines"`.

Default is expanded, matching the current always-visible log.

Collapsed means the drawer has class `collapsed`:

- `.log-lines` and `.filters` are `display: none`.
- The drawer no longer reserves `max-height: 30vh`. The main panel takes that space.
- The filter selection (All / MCP / SQL / Errors) stays in memory and is visible again on expand.

The click handler assigns `toggleLogDrawer(state)` and then updates the class and the button label. It does not splice the events, close `EventSource`, or call the server. SSE messages assign `appendLogEvent(state, event)` and re-render, including while collapsed, so lines that arrived hidden are in the DOM when the drawer opens.

`dev/tools/gui/client/log-drawer.ts` exports:

- `LogDrawerState<E>` = `{ collapsed: boolean; events: E[] }`
- `initialLogDrawer()` returns `{ collapsed: false, events: [] }`
- `toggleLogDrawer(state)` returns `{ collapsed: !state.collapsed, events: state.events }` (same array reference)
- `appendLogEvent(state, event)` returns `{ collapsed: state.collapsed, events: [...state.events, event] }`

Server `LogBus` is unchanged. Retention stays 500. Reload of the page starts expanded; the snapshot on `GET /api/logs` repopulates the client.

### Fill from schema

On the Tools tab, a **Fill from schema** button sits directly above `#tool-json`. It is `disabled` until a tool is selected. Selecting a tool still sets the textarea to `{}` and does not press the button for the user.

The click replaces the textarea value with `JSON.stringify(schemaSkeleton(selected.inputSchema), null, 2)`. It does not read or write the primitive form fields. Call behavior stays: `collectArgs` parses that JSON, then overlays top-level form fields (booleans always; numbers and strings when the form input is non-empty).

`schemaSkeleton` is a pure function in `dev/tools/gui/client/schema-skeleton.ts`. Input is the tool `inputSchema` (or `undefined`). Output is a JSON value:

Check order for a single schema node: union, then `enum`, then array, then object, then scalar. A node that has both a union and `properties` follows the union rule. When both `anyOf` and `oneOf` are present, `anyOf` is the union.

| Schema | Skeleton |
| --- | --- |
| argument `undefined`, or `type: "object"` (properties optional) | `{}` |
| no union, no enum, no type, and no `properties` | `null` |
| object `properties` | one key per property, including keys absent from `required` |
| `enum` with at least one value | the first value |
| `array` with an `items` schema | a one-element array of that item’s skeleton |
| `array` with tuple `items` | one skeleton per tuple slot |
| `array` with no `items` | `[]` |
| `integer` or `number` | `minimum` when it is a number, otherwise `0` |
| `boolean` | `false` |
| `string` | `""` |
| `anyOf` / `oneOf` | merge every object branch’s properties (later branch wins on a shared key) and skeleton that object; if no branch is an object, skeleton the first branch |
| `type` as an array | the first type that is not `"null"` |
| `default` | ignored, so `default: []` still becomes one exemplar element |
| object with only `additionalProperties` | `{}` (a record defines no field names) |

`$schema`, `description`, `required`, and `additionalProperties: false` do not appear in the instance. The SQL textarea is not a tool schema and gets no button.

Example shape for a nested optional array (the `seed_campaign` outline pattern):

```json
{
  "outline": {
    "places": [{ "key": "", "name": "" }]
  }
}
```

### Campaign list

`GET /api/campaigns` returns `{ campaigns: { id: string, name: string }[] }`.

`listCampaigns(repoRoot, dbPath)` in `dev/tools/gui/server/campaigns.ts`:

- Resolve the path the same way `runSql` does.
- If the file does not exist, return `[]`.
- If `sqlite_master` has no `campaigns` table, return `[]`.
- Otherwise `SELECT id, name FROM campaigns ORDER BY name COLLATE NOCASE, id`.
- Open a short-lived `better-sqlite3` connection the same way `runSql` does (not `readonly`), set `busy_timeout` to 500, close it in `finally`. The statement is that fixed `SELECT`. This route does not insert, update, or delete.
- A SQLite error other than “file missing” or “table missing” propagates. The HTTP handler’s existing error path returns 500 `{ error }`.

The route does not check MCP status. Stopped MCP is still HTTP 200. Success is not written to the traffic log. Failure is the normal 500 body; the client does not alert.

### Background load

`refreshCampaigns(): void` in `dev/tools/gui/client/campaigns.ts` starts a fetch and returns immediately. Callers do not await it.

Refreshes are chained on one promise so two overlapping calls cannot apply an older response after a newer one. A failed fetch leaves the previous list in place.

Call sites, each without `await`:

- the start of `boot()`, before config and the tools tab
- after a successful **Start MCP**
- after a successful **Save path**
- when a campaign menu opens

Tab mounts (`mountToolsTab`, `mountResourcesTab`, `mountPromptsTab`) do not await this fetch. They attach pickers to whatever list is already stored, and an open menu re-renders when the fetch completes.

### Campaign dropdown

A control is a campaign-id input when it is an `<input type="text">` and its name is exactly `campaignId`:

- Tools: top-level form field (`data-arg="campaignId"`), attached after the input is in the document
- Resources: URI param (`data-param="campaignId"`)
- Prompts: prompt argument (`data-arg="campaignId"`)

`attachCampaignPicker` runs only after the input is appended. It adds class `campaign-anchor` to the parent, inserts a listbox after the input, and opens it on focus. The input’s `aria-expanded` is `true` while the menu is open. Rows come from `campaignMenuRows`. Each row is a button whose text is `campaignOptionLabel`: `` `${name} — ${id}` `` (em dash). `mousedown` on a row prevents blur, sets `input.value` to the id, dispatches a bubbling `input` event, and closes the menu. Escape closes it. A document click outside the input and the menu closes it; that listener removes itself when the input is no longer connected, so remounting a tab does not leak listeners.

An empty list shows the text `No campaigns` and leaves the input editable.

```ts
export type CampaignOption = { id: string; name: string };
export function campaignOptionLabel(campaign: CampaignOption): string;
export function campaignMenuRows(campaigns: CampaignOption[]): { id: string; label: string }[];
```

### Files

| File | Responsibility |
| --- | --- |
| `dev/tools/gui/client/log-drawer.ts` | Collapse and append state. No DOM. |
| `dev/tools/gui/client/schema-skeleton.ts` | JSON skeleton. No DOM. |
| `dev/tools/gui/client/campaign-list.ts` | Option label and menu rows. No DOM. |
| `dev/tools/gui/client/campaigns.ts` | Background fetch and listbox. |
| `dev/tools/gui/server/campaigns.ts` | SQLite read of id and name. |
| `dev/tools/gui/client/main.ts`, `index.html`, `styles.css` | Toggle button, drawer class, boot refresh. |
| `dev/tools/gui/client/tabs/tools.ts` | Fill button and tool `campaignId` picker. |
| `dev/tools/gui/client/tabs/resources.ts`, `prompts.ts` | `campaignId` picker. |
| `dev/tools/gui/server/http.ts` | `GET /api/campaigns`. |
| `dev/tools/gui/README.md` | How to collapse, fill, and pick. |
| `test/dev-gui/*.test.ts` | Pure functions and the HTTP route. |

### Error handling

| Situation | Behavior |
| --- | --- |
| Collapse, expand, collapse again | Events array identity is preserved across toggles. Appends while collapsed remain. |
| Fill with no tool selected | Button stays disabled. |
| Fill when `inputSchema` is missing | Textarea becomes `{}`. |
| Database file not created yet | `GET /api/campaigns` is 200 `{ campaigns: [] }`. Inputs still accept a typed id. |
| `campaigns` table absent | Same empty list. |
| SQLite error (locked past the busy timeout, missing `name` column) | HTTP 500. Client keeps the previous list and does not `alert`. |
| Menu opened before the first fetch returns | Menu shows `No campaigns` or the previous list, then updates if it is still open. |

### README

`dev/tools/gui/README.md` “Using it” gains three facts: the traffic log header collapses without clearing the log; **Fill from schema** replaces the tool JSON with every schema field; campaign id fields offer a `name — id` menu fed by a background load of the current database file.

### Testing

Vitest, node environment, no new dependency. Tests import the pure modules and the HTTP handler. They do not launch a browser.

- `schemaSkeleton` covers optional properties, enums, minimums, nested arrays, records, `anyOf` object merge, ignored `default: []`, and a missing schema.
- `toggleLogDrawer` returns the same events reference and flips `collapsed`. `appendLogEvent` keeps `collapsed` and the earlier events.
- `campaignOptionLabel` / `campaignMenuRows` cover `name — id`.
- `listCampaigns` covers missing file, missing table, and `ORDER BY name COLLATE NOCASE, id`.
- `GET /api/campaigns` returns 200 with rows while MCP is stopped, and 200 `{ campaigns: [] }` when the file is absent.

DOM wiring is the thin caller of those functions, specified in the implementation plan. There is no happy-dom dependency.
