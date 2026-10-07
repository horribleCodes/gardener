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

test("apply_outcome accepts an optional changeId", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools();
    const apply = tools.tools.find((tool) => tool.name === "apply_outcome");
    expect(apply).toBeDefined();
    const schema = apply!.inputSchema as {
      required?: string[];
      properties: { changeId?: { type: string } };
    };
    expect(schema.properties.changeId).toEqual({ type: "string" });
    expect(schema.required).toEqual(["campaignId", "factionId"]);
  });
});
