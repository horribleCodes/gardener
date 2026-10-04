import { expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../src/mcp/register.js";

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

function textOf(result: { content: unknown }): string {
  return (result.content as { text: string }[])[0].text;
}

test("seed_campaign place scope is required and stays the five-value enum", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools();
    const seed = tools.tools.find((tool) => tool.name === "seed_campaign");
    expect(seed).toBeDefined();
    const schema = seed!.inputSchema as {
      required?: string[];
      properties: {
        outline: {
          properties: {
            places: { items: { required?: string[]; properties: { scope: { enum: string[] } } } };
            factions: { items: { required?: string[] } };
          };
        };
      };
    };
    expect(schema.required).toEqual(["name"]);
    expect(schema.properties.outline.properties.places.items.required).toEqual([
      "key",
      "name",
      "scope",
    ]);
    expect(schema.properties.outline.properties.places.items.properties.scope.enum).toEqual([
      "village",
      "city",
      "region",
      "nation",
      "realm",
    ]);
    expect(schema.properties.outline.properties.factions.items.required).toEqual(["key", "name"]);
  });
});

test("omitted place scope fails validation before the handler", async () => {
  await withClient(async (client) => {
    const missing = await client.callTool({
      name: "seed_campaign",
      arguments: {
        name: "Campaign",
        outline: { places: [{ key: "home", name: "Home" }] },
      },
    });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe(
      "MCP error -32602: Input validation error: Invalid arguments for tool seed_campaign: Required at outline.places[0].scope",
    );

    const later = await client.callTool({
      name: "seed_campaign",
      arguments: {
        name: "Campaign",
        outline: {
          places: [
            { key: "home", name: "Home", scope: "city" },
            { key: "far", name: "Far" },
          ],
        },
      },
    });
    expect(later.isError).toBe(true);
    expect(textOf(later)).toBe(
      "MCP error -32602: Input validation error: Invalid arguments for tool seed_campaign: Required at outline.places[1].scope",
    );
  });
});

test("a scope outside the enum is rejected", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "seed_campaign",
      arguments: {
        name: "Campaign",
        outline: { places: [{ key: "home", name: "Home", scope: "hamlet" }] },
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "MCP error -32602: Input validation error: Invalid arguments for tool seed_campaign: Invalid enum value. Expected 'village' | 'city' | 'region' | 'nation' | 'realm', received 'hamlet' at outline.places[0].scope",
    );
  });
});

test("an explicit city or village scope seeds", async () => {
  await withClient(async (client) => {
    for (const scope of ["city", "village"] as const) {
      const result = await client.callTool({
        name: "seed_campaign",
        arguments: {
          name: "Campaign",
          seed: 1,
          outline: { places: [{ key: "home", name: "Home", scope }] },
        },
      });
      expect(result.isError).toBeFalsy();
      const body = JSON.parse(textOf(result)) as { ok: boolean; data: { campaignId: string } };
      expect(body.ok).toBe(true);
      expect(body.data.campaignId).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});
