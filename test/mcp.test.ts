import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/register.js";
import { runTool } from "../src/mcp/envelope.js";
import { openDb } from "../src/store/db.js";
import { openParallelTurn } from "../src/services/queue.js";

test("MCP server is named gardener and registers create_hero", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  expect(client.getServerVersion()).toEqual({ name: "gardener", version: "0.1.0" });
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  expect(names).toContain("create_hero");
  expect(names).toContain("remove-campaign");
  expect(names).toContain("set_interest");
  expect(names).not.toContain("create_godbound");
  expect(names).toHaveLength(50);
  await client.close();
});

test("quote_change through MCP returns the ward example", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  const result = await client.callTool({
    name: "quote_change",
    arguments: { scope: "city", magnitude: "improbable", wardRatings: [4], resisterRatings: [] },
  });
  const text = (result.content as { text: string }[])[0].text;
  const body = JSON.parse(text);
  expect(body.ok).toBe(true);
  expect(body.data.total).toBe(12);
  await client.close();
});

test("get_unit_view for rivalry omits dominion and behavior; quote_change still 12", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-mcp-"));
  const dbPath = join(dir, "campaign.sqlite");
  const campaignId = "c-rival";
  const seed = openDb(dbPath);
  seed.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  ).run(campaignId, "Rival");
  for (const [id, name, home, behavior, dom] of [
    ["us", "Us", "p", "directed", 3],
    ["them", "Them", "far", "despotic_tyrant", 9],
  ] as const) {
    seed.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status, home_place_id)
       VALUES (?, ?, ?, 1, 1, ?, 'existing', ?, 'npc', 0, 'active', ?)`,
    ).run(id, campaignId, name, dom, behavior, home);
  }
  seed.prepare(
    `INSERT INTO places (id, campaign_id, name, scope, parent_place_id) VALUES ('p', ?, 'Home', 'village', NULL), ('far', ?, 'Far', 'city', NULL)`,
  ).run(campaignId, campaignId);
  seed.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin, covert)
     VALUES ('f1', 'them', 'Open market', 'economic', 'native', 0),
            ('f2', 'them', 'Secret rifles', 'military', 'native', 1)`,
  ).run();
  seed.prepare(
    `INSERT INTO problems (id, faction_id, text, domain, points, intrinsic, external, resistance, position)
     VALUES ('pr1', 'them', 'Bandits', 'military', 1, 0, 0, 0, 0), ('pr2', 'them', 'Empty treasury', 'economic', 1, 0, 0, 0, 1)`,
  ).run();
  seed.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature) VALUES ('i1', 'us', 'them', 4, 'rivalry')`,
  ).run();
  openParallelTurn(seed, dbPath, { campaignId, unitIds: ["us", "them"] });
  seed.close();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(dbPath);
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);

  const viewResult = await client.callTool({
    name: "get_unit_view",
    arguments: { campaignId, unitType: "faction", unitId: "us" },
  });
  const viewBody = JSON.parse((viewResult.content as { text: string }[])[0].text);
  expect(viewBody.ok).toBe(true);
  const them = viewBody.data.known.factions.find((f: { id: string }) => f.id === "them");
  expect(them).toBeDefined();
  expect(them).not.toHaveProperty("dominion");
  expect(them).not.toHaveProperty("behavior");
  expect(JSON.stringify(viewBody.data)).not.toContain("despotic_tyrant");

  const quoteResult = await client.callTool({
    name: "quote_change",
    arguments: { scope: "city", magnitude: "improbable", wardRatings: [4], resisterRatings: [] },
  });
  const quoteBody = JSON.parse((quoteResult.content as { text: string }[])[0].text);
  expect(quoteBody.data.total).toBe(12);
  await client.close();
});

test("set_interest writes a directed spies edge", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);

  const campaignText = (
    await client.callTool({
      name: "create_campaign",
      arguments: { name: "Interest", rngSeed: 1 },
    })
  ).content as { text: string }[];
  const campaign = JSON.parse(campaignText[0].text);
  const campaignId = campaign.data.campaignId as string;

  const makeFaction = async (name: string) => {
    const text = (
      await client.callTool({
        name: "create_faction",
        arguments: { campaignId, name, power: 1, behavior: "directed" },
      })
    ).content as { text: string }[];
    return JSON.parse(text[0].text).data.factionId as string;
  };
  const fromFactionId = await makeFaction("A");
  const toFactionId = await makeFaction("B");

  const result = await client.callTool({
    name: "set_interest",
    arguments: { campaignId, fromFactionId, toFactionId, nature: "spies" },
  });
  const body = JSON.parse((result.content as { text: string }[])[0].text);
  expect(body.ok).toBe(true);
  expect(body.data).toMatchObject({
    fromFactionId,
    toFactionId,
    nature: "spies",
    points: 1,
  });
  await client.close();
});

test("runTool returns envelope instead of rejecting on unexpected errors", () => {
  const result = runTool(() => {
    throw new Error("simulated bug");
  });
  const envelope = result.structuredContent as {
    ok: boolean;
    error?: { code: string; message: string; details: { unexpected?: boolean } };
  };
  expect(envelope.ok).toBe(false);
  expect(envelope.error?.code).toBe("ENTITY_NOT_FOUND");
  expect(envelope.error?.message).toBe("simulated bug");
  expect(envelope.error?.details.unexpected).toBe(true);
});

test("remove-campaign deletes the campaign through MCP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-mcp-rm-"));
  const dbPath = join(dir, "campaign.sqlite");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(dbPath);
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);

  const created = await client.callTool({
    name: "create_campaign",
    arguments: { name: "Drop" },
  });
  const createdBody = JSON.parse((created.content as { text: string }[])[0].text);
  expect(createdBody.ok).toBe(true);
  const campaignId = createdBody.data.campaignId as string;

  const removed = await client.callTool({
    name: "remove-campaign",
    arguments: { campaignId },
  });
  const removedBody = JSON.parse((removed.content as { text: string }[])[0].text);
  expect(removedBody.ok).toBe(true);
  expect(removedBody.data.campaignId).toBe(campaignId);
  expect(removedBody.rolls).toEqual([]);
  expect(removedBody.derived).toEqual({});

  const brief = await client.callTool({
    name: "get_world_brief",
    arguments: { campaignId },
  });
  const briefBody = JSON.parse((brief.content as { text: string }[])[0].text);
  expect(briefBody.ok).toBe(false);
  expect(briefBody.error.code).toBe("CAMPAIGN_NOT_FOUND");

  await client.close();
});
