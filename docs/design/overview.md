# Design overview

Living design framing for Gardener. Work tracking and sequencing live in the repository’s GitHub Project and issues—not in a markdown roadmap.

## What runs today

The server implements the Godbound **strain** profile: monthly faction turns, influence, world-changes, and related MCP tools. That v1 shape is described in [godbound-faction-mcp-design.md](../superpowers/specs/2026-09-21-godbound-faction-mcp-design.md) (historical spec).

## Where the design is going

The target is a setting-neutral **agnostic world system**: one actor model, campaign profiles (`strain` or `assets`), and presets that flip flags and catalogs rather than hard-coding one game. Full mechanics, flags, and presets are in [agnostic-world-system-design.md](../superpowers/specs/2026-09-23-agnostic-world-system-design.md) (historical spec).

At a high level:

- **Profile 1: Strain** — cohesion, trouble, projects, and the turn v1 already runs (Godbound, Ashes-style communities).
- **Profile 2: Assets** — Force, Cunning, Wealth, located assets, and goals; a second rules module, not hit points pasted onto strain features.

## How to change the codebase

The project is still in early phases. Until the module manifest wave is complete, prefer replacing the current shape over carrying legacy call shapes or file layouts. Backwards compatibility matters once live module edits and multi-campaign directories are in play—not for every intermediate refactor.

Domain rules stay authoritative in `src/`; services coordinate persistence; the MCP layer adapts tools. Play-facing instructions belong under [`user/`](../../user/).

## Historical specs

Dated plans and specs under [`docs/superpowers/`](../superpowers/) record how past features were specified and built. They are not updated after merge. Use [`docs/design/`](./) and the code for current intent; follow links into superpowers only when you need full historical detail.
