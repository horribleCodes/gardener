import { api } from "../api";

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema & { description?: string; enum?: unknown[] }>;
  required?: string[];
};

type Tool = {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
};

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function collectArgs(schema: JsonSchema | undefined, jsonText: string, form: HTMLElement): Record<string, unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new Error("Arguments JSON is invalid");
  }
  const props = schema?.properties ?? {};
  for (const key of Object.keys(props)) {
    const input = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-arg="${CSS.escape(key)}"]`);
    if (!input) continue;
    const spec = props[key];
    if (spec.type === "boolean") {
      args[key] = (input as HTMLInputElement).checked;
    } else if (spec.type === "number" || spec.type === "integer") {
      const n = Number(input.value);
      if (input.value !== "") args[key] = n;
    } else if (input.value !== "") {
      args[key] = input.value;
    }
  }
  return args;
}

function renderForm(schema: JsonSchema | undefined, host: HTMLElement) {
  host.replaceChildren();
  const props = schema?.properties;
  if (!props) return;
  for (const [key, spec] of Object.entries(props)) {
    const label = document.createElement("label");
    label.textContent = `${key}${spec.description ? ` — ${spec.description}` : ""}`;
    let field: HTMLElement;
    if (spec.enum) {
      const select = document.createElement("select");
      select.dataset.arg = key;
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "";
      select.append(blank);
      for (const option of spec.enum) {
        const opt = document.createElement("option");
        opt.value = String(option);
        opt.textContent = String(option);
        select.append(opt);
      }
      field = select;
    } else if (spec.type === "boolean") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.arg = key;
      field = input;
    } else {
      const input = document.createElement("input");
      input.type = spec.type === "number" || spec.type === "integer" ? "number" : "text";
      input.dataset.arg = key;
      field = input;
    }
    label.append(field);
    host.append(label);
  }
}

export async function mountToolsTab(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="split">
      <div>
        <input class="search" id="tool-search" placeholder="Search tools" />
        <div id="tool-list" class="list"></div>
      </div>
      <div class="detail">
        <p id="tool-desc" class="hint">Select a tool.</p>
        <div id="tool-fields" class="fields"></div>
        <textarea id="tool-json" class="code">{}</textarea>
        <button id="tool-call" type="button">Call</button>
        <pre id="tool-result" class="json"></pre>
      </div>
    </div>`;

  const listEl = container.querySelector("#tool-list")!;
  const desc = container.querySelector("#tool-desc")!;
  const fields = container.querySelector("#tool-fields") as HTMLElement;
  const jsonArea = container.querySelector("#tool-json") as HTMLTextAreaElement;
  const result = container.querySelector("#tool-result")!;
  const search = container.querySelector("#tool-search") as HTMLInputElement;
  let tools: Tool[] = [];
  let selected: Tool | undefined;

  const renderList = () => {
    const q = search.value.toLowerCase();
    listEl.replaceChildren();
    for (const tool of tools.filter((t) => t.name.toLowerCase().includes(q))) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = tool.name;
      btn.addEventListener("click", () => {
        selected = tool;
        desc.textContent = `${tool.name}: ${tool.description ?? ""}`;
        renderForm(tool.inputSchema, fields);
        jsonArea.value = "{}";
      });
      listEl.append(btn);
    }
  };

  try {
    const payload = await api<{ tools: Tool[] }>("/api/mcp/tools");
    tools = [...payload.tools].sort((a, b) => a.name.localeCompare(b.name));
    renderList();
  } catch (error) {
    desc.textContent = error instanceof Error ? error.message : String(error);
    desc.classList.add("error");
  }

  search.addEventListener("input", renderList);

  container.querySelector("#tool-call")!.addEventListener("click", async () => {
    if (!selected) return;
    try {
      const args = collectArgs(selected.inputSchema, jsonArea.value, fields);
      const body = await api<{ envelope?: unknown; content?: unknown; isError?: boolean }>(
        "/api/mcp/tools/call",
        { method: "POST", body: JSON.stringify({ name: selected.name, arguments: args }) },
      );
      result.className = `json ${body.isError || (body.envelope && typeof body.envelope === "object" && body.envelope && "ok" in body.envelope && (body.envelope as { ok: unknown }).ok === false) ? "error" : ""}`;
      result.textContent = pretty(body.envelope ?? body.content ?? body);
    } catch (error) {
      result.className = "json error";
      result.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}
