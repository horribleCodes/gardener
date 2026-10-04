import { api } from "./api";
import { refreshCampaigns } from "./campaigns";
import { appendLogEvent, initialLogDrawer, toggleLogDrawer } from "./log-drawer";
import { mountToolsTab } from "./tabs/tools";
import { mountResourcesTab } from "./tabs/resources";
import { mountPromptsTab } from "./tabs/prompts";
import { mountSqlTab } from "./tabs/sql";

type Status = {
  status: string;
  dbPath?: string;
  serverVersion?: { name: string; version: string };
};

type ClientLogEvent = {
  level: string;
  direction: string;
  ts: string;
  summary: string;
  detail?: string;
};

const statusEl = document.getElementById("status")!;
const dbPathEl = document.getElementById("db-path") as HTMLInputElement;
const saveBtn = document.getElementById("btn-save-path") as HTMLButtonElement;
const startBtn = document.getElementById("btn-start") as HTMLButtonElement;
const stopBtn = document.getElementById("btn-stop") as HTMLButtonElement;
const panel = document.getElementById("panel")!;
const logLines = document.getElementById("log-lines")!;
const logDrawer = document.getElementById("log-drawer")!;
const logToggle = document.getElementById("log-toggle") as HTMLButtonElement;

let logFilter: "all" | "mcp" | "sql" | "error" = "all";
let drawerState = initialLogDrawer<ClientLogEvent>();

function applyLogDrawer(): void {
  logDrawer.classList.toggle("collapsed", drawerState.collapsed);
  logToggle.textContent = drawerState.collapsed ? "Expand" : "Collapse";
  logToggle.setAttribute("aria-expanded", String(!drawerState.collapsed));
}

async function refreshStatus() {
  const s = await api<Status>("/api/mcp/status");
  const connected = s.status === "connected";
  statusEl.textContent =
    s.status === "connected"
      ? `Connected (${s.serverVersion?.name} ${s.serverVersion?.version})`
      : s.status === "connecting"
        ? "Connecting"
        : "Stopped";
  statusEl.className = `badge ${connected ? "ok" : ""}`;
  dbPathEl.disabled = connected || s.status === "connecting";
  saveBtn.disabled = dbPathEl.disabled;
  if (s.dbPath && document.activeElement !== dbPathEl) dbPathEl.value = s.dbPath;
}

startBtn.addEventListener("click", async () => {
  try {
    await api("/api/mcp/start", { method: "POST" });
    await refreshStatus();
    refreshCampaigns();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    await api("/api/mcp/stop", { method: "POST" });
    await refreshStatus();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
});

saveBtn.addEventListener("click", async () => {
  try {
    await api("/api/config/db-path", {
      method: "PUT",
      body: JSON.stringify({ path: dbPathEl.value }),
    });
    await refreshStatus();
    refreshCampaigns();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
});

function renderLog() {
  logLines.replaceChildren();
  for (const event of drawerState.events) {
    if (logFilter === "mcp" && event.direction !== "mcp") continue;
    if (logFilter === "sql" && event.direction !== "sql") continue;
    if (logFilter === "error" && event.level !== "error") continue;
    const line = document.createElement("div");
    line.className = `log-line ${event.level === "error" ? "error" : ""}`;
    line.textContent = `${event.ts} [${event.direction}/${event.level}] ${event.summary}${event.detail ? ` — ${event.detail}` : ""}`;
    logLines.append(line);
  }
  logLines.scrollTop = logLines.scrollHeight;
}

logToggle.addEventListener("click", () => {
  drawerState = toggleLogDrawer(drawerState);
  applyLogDrawer();
});

const es = new EventSource("/api/logs");
es.onmessage = (ev) => {
  try {
    drawerState = appendLogEvent(drawerState, JSON.parse(ev.data) as ClientLogEvent);
    renderLog();
  } catch {
    /* ignore malformed SSE */
  }
};

for (const btn of document.querySelectorAll<HTMLButtonElement>(".filters button")) {
  btn.addEventListener("click", () => {
    logFilter = btn.dataset.filter as typeof logFilter;
    for (const other of document.querySelectorAll(".filters button")) other.classList.remove("active");
    btn.classList.add("active");
    renderLog();
  });
}

const tabs: Record<string, (el: HTMLElement) => void | Promise<void>> = {
  tools: mountToolsTab,
  resources: mountResourcesTab,
  prompts: mountPromptsTab,
  sql: mountSqlTab,
};

async function showTab(name: string) {
  panel.replaceChildren();
  await tabs[name]?.(panel);
}

for (const btn of document.querySelectorAll<HTMLButtonElement>(".tabs button")) {
  btn.addEventListener("click", () => {
    for (const other of document.querySelectorAll(".tabs button")) other.classList.remove("active");
    btn.classList.add("active");
    void showTab(btn.dataset.tab ?? "tools");
  });
}

async function boot() {
  refreshCampaigns();
  try {
    const cfg = await api<{ dbPath: string }>("/api/config");
    dbPathEl.value = cfg.dbPath;
  } catch {
    /* status will surface errors */
  }
  await refreshStatus().catch((error) => {
    statusEl.textContent = error instanceof Error ? error.message : "API unreachable";
    statusEl.className = "badge err";
  });
  await showTab("tools");
}

void boot();
