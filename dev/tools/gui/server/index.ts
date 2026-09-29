import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGuiHandler } from "./http.js";
import { LogBus } from "./log-bus.js";
import { McpSession } from "./mcp-session.js";

const HOST = "127.0.0.1";
const PORT = 3847;

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    const pkg = path.join(dir, "package.json");
    const server = path.join(dir, "src/server.ts");
    if (existsSync(pkg) && existsSync(server)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("REPO_ROOT_NOT_FOUND");
    dir = parent;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);
const defaultDb = process.env.GARDENER_WORLD_DB ?? path.join(repoRoot, "data/campaign.sqlite");
const log = new LogBus();
const session = new McpSession(repoRoot, defaultDb, log);
const staticDirCandidates = [
  path.join(here, "../dist-client"),
  path.join(here, "../../dist-client"),
];
const staticDir = staticDirCandidates.find((dir) => existsSync(path.join(dir, "index.html")));

const server = createServer(createGuiHandler({ repoRoot, log, session, staticDir }));
server.listen(PORT, HOST, () => {
  const ui = staticDir ? `http://${HOST}:${PORT}` : `http://${HOST}:5173 (Vite) + API http://${HOST}:${PORT}`;
  process.stderr.write(`Gardener dev GUI listening on ${ui}\n`);
});

const shutdown = async () => {
  await session.stop();
  server.close();
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
