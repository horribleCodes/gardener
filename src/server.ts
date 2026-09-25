import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./mcp/register.js";

const db = process.env.GARDENER_WORLD_DB ?? "./data/campaign.sqlite";
const server = buildServer(db);
await server.connect(new StdioServerTransport());
