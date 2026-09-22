import { expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/register.js";

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
