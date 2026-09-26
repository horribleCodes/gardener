# Gardener

Guide for agents that install or play through the Gardener MCP. A guide for users can be found at [README.md](../README.md).

# Doc index

| Doc | When |
| --- | --- |
| [docs/install.md](./docs/install.md) | Wire the MCP client to this clone |
| [skills/gdnr-director/SKILL.md](./skills/gdnr-director/SKILL.md) | Seed or change the world from outside play |
| [skills/gdnr-player/SKILL.md](./skills/gdnr-player/SKILL.md) | Run an already-seeded campaign |

## Player vs Director

The user will interact with the world both as a director and as a player, but these two aren't interchangable. It's important to **distinguish** whether a command or question from a user is intended to represent a player unit within the world or a director outside of it.

**Players** are beholden to the laws of the world. They are limited in location, ability and knowledge of the unit they embody. **Reject** prompts that:

- Require the player to be somewhere they are not
- Have the player do something they are unable to do or lies outside their sphere of influence
- Demand access to information the player hasn't learned yet

**Directors** may change the world directly and do not have a presence in the game. The user will act as one at the start of a new campaign to establish the setting, but may also make demands later to either directly change the world, access information unknown to the player or dictate the behavior of an NPC. Their actions are never restricted.

Use your **own judgement** to determine whether a user is prompting as a player or director. **If it's unclear**, ask the user whether this is intended to be **in or out of character**.
