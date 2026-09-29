import { api } from "../api";
import { submitOnEnter } from "../submit-key";

type JsonSchema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
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

function schemaItem(schema: JsonSchema): JsonSchema | undefined {
  if (!schema.items || Array.isArray(schema.items)) return undefined;
  return schema.items;
}

function recordValue(schema: JsonSchema): JsonSchema | undefined {
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    return schema.additionalProperties;
  }
  return undefined;
}

function typeLabel(schema: JsonSchema): string {
  if (schema.enum?.length) return schema.enum.map((value) => String(value)).join(" | ");
  const union = schema.anyOf ?? schema.oneOf;
  if (union?.length) return union.map(typeLabel).join(" | ");
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (schema.type === "array") {
    const item = schemaItem(schema);
    return item ? `array of ${typeLabel(item)}` : "array";
  }
  if (schema.type === "integer" || schema.type === "number") {
    if (typeof schema.minimum === "number" && typeof schema.maximum === "number") {
      return `${schema.type} ${schema.minimum}–${schema.maximum}`;
    }
    if (typeof schema.minimum === "number") return `${schema.type} ≥ ${schema.minimum}`;
    if (typeof schema.maximum === "number") return `${schema.type} ≤ ${schema.maximum}`;
    return schema.type;
  }
  const value = recordValue(schema);
  if (schema.type === "object" && !schema.properties && value) return `record of ${typeLabel(value)}`;
  return schema.type ?? "value";
}

function hasNested(schema: JsonSchema): boolean {
  if (schema.properties && Object.keys(schema.properties).length > 0) return true;
  const value = recordValue(schema);
  if (value && hasNested(value)) return true;
  const item = schemaItem(schema);
  return Boolean(item && hasNested(item));
}

function isFillable(schema: JsonSchema): boolean {
  if (hasNested(schema)) return false;
  if (schema.enum) return true;
  return schema.type === "boolean" || schema.type === "number" || schema.type === "integer" || schema.type === "string";
}

function renderInput(name: string, schema: JsonSchema): HTMLElement {
  if (schema.enum) {
    const select = document.createElement("select");
    select.dataset.arg = name;
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "";
    select.append(blank);
    for (const option of schema.enum) {
      const opt = document.createElement("option");
      opt.value = String(option);
      opt.textContent = String(option);
      select.append(opt);
    }
    return select;
  }
  const input = document.createElement("input");
  input.dataset.arg = name;
  if (schema.type === "boolean") input.type = "checkbox";
  else if (schema.type === "number" || schema.type === "integer") input.type = "number";
  else input.type = "text";
  return input;
}

function renderField(name: string, schema: JsonSchema, required: boolean, editable: boolean): HTMLElement {
  const field = document.createElement("div");
  field.className = "schema-field";

  const head = document.createElement("div");
  head.className = "schema-head";
  const nameEl = document.createElement("span");
  nameEl.className = "schema-name";
  nameEl.textContent = required ? `${name}*` : name;
  const meta = document.createElement("span");
  meta.className = "schema-meta";
  meta.textContent = schema.description ? `${typeLabel(schema)} — ${schema.description}` : typeLabel(schema);
  head.append(nameEl, meta);
  if (editable && !isFillable(schema)) {
    const note = document.createElement("span");
    note.className = "schema-meta";
    note.textContent = "Set this in the JSON arguments.";
    head.append(note);
  }
  field.append(head);

  if (editable && isFillable(schema)) field.append(renderInput(name, schema));

  const nest = document.createElement("div");
  nest.className = "schema-nest";
  if (schema.properties && hasNested(schema)) {
    appendSchemaFields(schema, nest);
  } else {
    const item = schemaItem(schema);
    const value = recordValue(schema);
    if (item && hasNested(item)) appendSchemaFields(item, nest);
    else if (value && hasNested(value)) nest.append(renderField("(each value)", value, false, false));
  }
  if (nest.childElementCount > 0) field.append(nest);
  return field;
}

function appendSchemaFields(schema: JsonSchema, host: HTMLElement): void {
  const required = new Set(schema.required ?? []);
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    host.append(renderField(key, child, required.has(key), false));
  }
  const value = recordValue(schema);
  if (value && hasNested(value)) host.append(renderField("(each value)", value, false, false));
}

function renderForm(schema: JsonSchema | undefined, host: HTMLElement) {
  host.replaceChildren();
  const props = schema?.properties;
  if (!props) return;
  const required = new Set(schema.required ?? []);
  for (const [key, spec] of Object.entries(props)) {
    host.append(renderField(key, spec, required.has(key), true));
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

  const call = container.querySelector("#tool-call") as HTMLButtonElement;
  submitOnEnter(container.querySelector(".detail")!, () => call.click());
  call.addEventListener("click", async () => {
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
