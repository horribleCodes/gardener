# Agent instruction file implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `docs/agent/current-mcp-tools.md` and wire discovery so play agents read it before using Gardener MCP tools, closing the gap documented in the 24 Sep 2026 playtest.

**Architecture:** Documentation-only change. No edits to `src/mcp/register.ts`, services, or schema. `AGENTS.md` and `README.md` gain short pointers. Optional Vitest guard compares registered tool names to the markdown index.

**Tech Stack:** Markdown, npm (repo root), Vitest 2 if the guard test is added.

## Global constraints

- Design: `docs/superpowers/specs/2026-09-25-agent-instruction-file-design.md`. If this plan disagrees, fix the plan.
- GitHub issue: https://github.com/horribleCodes/gardener/issues/15
- Do **not** edit `docs/ROADMAP.md` in this work.
- Do **not** add MCP tools or change tool descriptions as part of this item.
- Keep the instruction file shorter than the Godbound design spec; no catalog JSON dumps.
- Names: server is `gardener`; hero tools use `create_hero`, not legacy godbound names.

---

### Task 1: Add the instruction file

**Files:**
- Create: `docs/agent/current-mcp-tools.md`

**Interfaces:**
- Consumes: design spec sections 1–7; playtest section “What an instruction file should state”; current `src/mcp/register.ts` tool list.
- Produces: the markdown file agents read at play time.

- [ ] **Step 1: Extract tool names**

From repo root:

```bash
rg '^\s+"([a-z_]+)",' src/mcp/register.ts -r '$1' -o | sort -u
```

Expect 48 tool names (adjust the plan if the count changes).

- [ ] **Step 2: Draft the file**

Write `docs/agent/current-mcp-tools.md` with:

- Sunset banner (items 17 and 26).
- Sections matching design spec §1–7.
- Tool map grouped as in the design; every name from Step 1 appears exactly once.
- The “blocked on interests” playbook (design §7).

- [ ] **Step 3: Self-review against playtest**

Confirm the doc answers: why Ashbanner/Covenant war became facts; which three directed edges would have been needed; why `extend_interest` was wrong for setup.

- [ ] **Step 4: Commit**

```bash
git add docs/agent/current-mcp-tools.md
git commit -m "docs: add agent instruction file for current MCP tools"
```

---

### Task 2: Wire discovery

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] **Step 1: AGENTS.md**

After the install section, add **Play a campaign** (or equivalent):

- Before calling Gardener MCP tools for world setup or play, read `docs/agent/current-mcp-tools.md`.
- One sentence on why (interest edges vs facts).

Do not remove or shorten install steps.

- [ ] **Step 2: README.md**

Under **Install**, add a **Play** subsection with the same link (one short paragraph).

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs: point agents and readers at MCP play instructions"
```

---

### Task 3: Optional tool-index guard (recommended)

**Files:**
- Create: `test/docs/current-mcp-tools.test.ts`

**Interfaces:**
- Consumes: `docs/agent/current-mcp-tools.md`, `src/mcp/register.ts`
- Produces: failing test if a registered tool is missing from the doc or the doc lists a nonexistent tool.

- [ ] **Step 1: Write the test**

Parse register tool names with the same regex as Task 1. Parse the doc for backtick-wrapped tool names in the tool map section (or a dedicated `<!-- tools:begin -->` … `<!-- tools:end -->` block if easier to parse).

Assert sets are equal.

- [ ] **Step 2: Run**

```bash
npm test -- test/docs/current-mcp-tools.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add test/docs/current-mcp-tools.test.ts
git commit -m "test: keep MCP tool index in agent instructions in sync"
```

---

### Task 4: Manual verification

- [ ] **Step 1: Read-through**

A second pass: no absolute machine paths; interest nature list matches `src/tables/catalog.json` `interestNature` texts.

- [ ] **Step 2: Playtest scenario desk-check**

Using only the instruction file, write three bullet answers:

1. What happens if you `create_faction` two warring groups after seed?
2. Which tool writes starting interests?
3. What should the agent say when the user wants explicit `spies` after seed?

Answers must match the design acceptance criteria.

- [ ] **Step 3: Note in PR**

In the PR test plan (when implementing), mark manual desk-check done. No MCP server code changes to validate.

---

### Task 5: Close the issue

- [ ] Link PR to https://github.com/horribleCodes/gardener/issues/15 in the PR description.
- [ ] After merge, close issue 15 (or let the maintainer close via keyword).
