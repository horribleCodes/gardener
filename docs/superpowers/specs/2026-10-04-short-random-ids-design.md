# Short random ids

> Status: design for issue #80. Not implemented on this branch. Living engine docs to update at implementation time: [`docs/design/glossary.md`](../../../docs/design/glossary.md), [`docs/design/current-engine.md`](../../../docs/design/current-engine.md).

## Purpose

The server mints a full UUID v4 at every new row id. Those strings are longer than this world needs. New random ids become 8 lowercase hex characters from one shared function, and ids already stored keep working.

Issue #80 already decided the product shape:

- One shared generator (for example `newId()`) returns 8 characters for new random ids.
- The alphabet is hex (`0-9`, `a-f`). Eight hex characters are about 32 bits. That collision risk is accepted.
- Existing longer ids stay valid so old worlds do not break.
- Living design may note the convention. Any UUID line under `docs/superpowers/` is historical only.
- Do not migrate or rewrite existing persisted ids.

There is no **Open questions** section on the issue. The choices below are the ones the issue left to this spec.

## Approaches

Three ways to shorten new ids.

**A. `newId()` from 4 random bytes, hex-encoded. Recommended.**

`src/services/ids.ts` exports `newId(): string`. It calls `randomBytes(4).toString("hex")` from `node:crypto`. Four bytes are exactly 8 lowercase hex characters and exactly 32 bits. Every `crypto.randomUUID()` under `src/` becomes a call to `newId()`. Schema columns stay `TEXT`. Lookups stay exact string equality.

**B. Slice a UUID.**

`crypto.randomUUID().replaceAll("-", "").slice(0, 8)` is also 8 hex characters, but it keeps the UUID call the issue is replacing and throws away the rest of the value. Rejected.

**C. A different alphabet or a library id (nanoid, base32, a longer string).**

Issue #80 puts a later alphabet change out of scope. Rejected.

A retry loop on primary-key collision is also rejected. The issue accepts the collision risk. A duplicate insert surfaces as a SQLite constraint error, the same class of failure a UUID collision would.

## Shape

### Generator

```ts
import { randomBytes } from "node:crypto";

export function newId(): string {
  return randomBytes(4).toString("hex");
}
```

| Property | Value |
| --- | --- |
| Module | `src/services/ids.ts` |
| Export | `newId(): string` only. No length argument, no alphabet argument |
| Alphabet | lowercase hex, `0-9` and `a-f` |
| Length | 8 characters, no hyphens |
| Source | `randomBytes(4)` (32 bits) |
| Case | lowercase. SQLite’s default collation is case-sensitive, and `toString("hex")` is already lowercase |
| Leading zeros | kept. The value is text, never parsed as an integer |

Services import it with `import { newId } from "./ids.js"`. Domain rules, the MCP layer, and `user/` skills do not mint ids. `src/services/util.ts` is the wrong home: it already mixes rule helpers and SQL, and the generator has no database dependency.

### Call sites

Production code mints ids only with the global `crypto.randomUUID()`, and only under `src/services/`. Sixty-five call sites:

| File | Count | Lines |
| --- | --- | --- |
| `src/services/populate.ts` | 31 | 42, 59, 61, 62, 64, 77, 81, 89, 137, 251, 266, 289, 335, 375, 458, 663, 667, 801, 857, 898, 930, 1008, 1074, 1097, 1135, 1155, 1218, 1261, 1298, 1312, 1328 |
| `src/services/actions.ts` | 11 | 156, 253, 308, 403, 454, 616, 822, 852, 916, 965, 1021 |
| `src/services/change.ts` | 7 | 76, 98, 102, 493, 527, 604, 678 |
| `src/services/util.ts` | 6 | 89, 129, 207, 227, 236, 249 |
| `src/services/queue.ts` | 5 | 359, 398, 550, 584, 731 |
| `src/services/turn.ts` | 4 | 275, 757, 808, 1177 |
| `src/services/collapse.ts` | 1 | 33 |

Each call becomes `newId()`. No other expression changes, except one local in `change.ts`.

`resolveWithdrawal` binds `const newId = crypto.randomUUID()` and uses that binding for the successor fact. A file-wide replace plus `import { newId }` would compile as `const newId = newId()`, which reads the local before it is initialized. Rename that binding to `successorFactId` before the replace. The two uses (the `INSERT` and the `superseded_by` update) take the new name.

After the edit, `src/` contains no `crypto.randomUUID`. `test/services/turn.test.ts` line 164 keeps `crypto.randomUUID()` so a fixture can still insert an old-shaped id.

### Stored ids

`campaigns.id` and every other id column are already `TEXT PRIMARY KEY` with no length check. `SCHEMA_VERSION` stays 4. No migration, no `CHECK`, no backfill.

`requireCampaign` and the other loaders compare the string they are given to the stored string. A 36-character UUID, an 8-character hex id, and a short fixture id such as `"c1"` all still address their rows. MCP inputs stay `z.string()` with no format constraint.

Uniqueness is per table, not global. Two tables may store the same 8 characters. Inside one table, about 77,000 ids is where a collision becomes about as likely as not (birthday bound on 2^32). A play world is far smaller. When a collision does happen, the insert throws. Callers do not catch that and mint another id.

## Out of scope

- Changing the alphabet later to base32 or a nanoid-style set.
- Rewriting ids already stored in worlds.
- A collision-retry loop, a uniqueness pre-check, or a new error code for duplicates.
- `SCHEMA_VERSION`, schema `CHECK`s, or a data migration.
- `user/` skill files. They do not describe id shape.
- Historical UUID lines under `docs/superpowers/` other than this document and its plan.
- The fixture `crypto.randomUUID()` in `test/services/turn.test.ts`.

## Docs at implementation time

Update living design only:

- [`docs/design/glossary.md`](../../../docs/design/glossary.md): add an **Identifier** entry after **Hero** and before **Module**, with this text:

  > A randomly generated **identifier** is 8 lowercase hex characters (`0-9`, `a-f`), about 32 bits. The server mints one through `newId()` whenever it creates a row id. Collision risk at that size is accepted; the generator does not retry. Identifiers already stored, including full UUID v4 values and short fixture ids, stay valid. Nothing rewrites them.

- [`docs/design/current-engine.md`](../../../docs/design/current-engine.md): add this subsection after **Campaigns and the database file**:

  > ## Identifiers
  >
  > New row ids minted by the server are 8 lowercase hex characters from `newId()`. A stored id is an opaque string: a full UUID from an older file, or a caller-chosen id, still addresses its row. The server does not rewrite existing ids and does not reject a longer id. Eight hex characters are about 32 bits. A duplicate inside one table surfaces as a SQLite constraint error; the generator does not retry.

- Do not edit `user/skills/**`.
- Do not rewrite historical superpowers specs.

## Testing

`test/services/ids.test.ts` covers the generator alone:

- Each value matches `/^[0-9a-f]{8}$/`.
- 1,000 calls are 1,000 distinct strings. That checks the function is not a constant. It does not claim collisions are impossible.

`test/services/short-id-persistence.test.ts` covers the world file:

- `createCampaign` returns a `campaignId` matching `/^[0-9a-f]{8}$/`, and that string is the `campaigns.id` that was inserted.
- A campaign row inserted with a full UUID (`11111111-2222-4333-8444-555555555555`) still loads through `requireCampaign`.

Then `npx vitest run` for the whole suite. No GUI tests. No skill-file tests. No schema-version test change.

## Architecture

```mermaid
flowchart LR
  svc["services that insert rows"]
  ids["newId"]
  db["SQLite TEXT primary keys"]
  svc --> ids --> db
```

Domain rules do not grow an id procedure. The MCP layer does not mint ids and does not validate their shape. Persistence keeps accepting whatever string is already stored.
