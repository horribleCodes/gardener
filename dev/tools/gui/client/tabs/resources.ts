import { api } from "../api";
import { attachCampaignPicker } from "../campaigns";
import { submitOnEnter } from "../submit-key";

type Template = { uriTemplate: string; name?: string; description?: string };

function paramNames(template: string): string[] {
  return [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const v = params[key];
    if (v === undefined || v === "") throw new Error(`Missing param: ${key}`);
    return encodeURIComponent(v);
  });
}

function resourceText(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const contents = (body as { contents?: unknown }).contents;
  if (!Array.isArray(contents)) return body;
  const texts = contents.flatMap((item) => {
    if (!item || typeof item !== "object" || !("text" in item)) return [];
    const text = (item as { text: unknown }).text;
    return typeof text === "string" ? [text] : [];
  });
  if (texts.length === 0) return body;
  const parsed = texts.map((text) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  });
  return parsed.length === 1 ? parsed[0] : parsed;
}

export async function mountResourcesTab(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="split">
      <div id="res-list" class="list"></div>
      <div class="detail">
        <p id="res-desc" class="hint">Select a resource template.</p>
        <div id="res-fields" class="fields"></div>
        <div class="actions">
          <button id="res-read" type="button">Read</button>
          <label class="check"><input id="res-raw" type="checkbox" /> Raw</label>
        </div>
        <pre id="res-result" class="json"></pre>
      </div>
    </div>`;

  const listEl = container.querySelector("#res-list")!;
  const desc = container.querySelector("#res-desc")!;
  const fields = container.querySelector("#res-fields") as HTMLElement;
  const result = container.querySelector("#res-result")!;
  const raw = container.querySelector("#res-raw") as HTMLInputElement;
  let selected: Template | undefined;
  let view: { ok: true; body: unknown } | { ok: false; message: string } | undefined;

  const render = () => {
    if (!view) {
      result.className = "json";
      result.textContent = "";
      return;
    }
    if (!view.ok) {
      result.className = "json error";
      result.textContent = view.message;
      return;
    }
    const value = raw.checked ? view.body : resourceText(view.body);
    result.className = "json";
    result.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  };

  raw.addEventListener("change", render);

  try {
    const payload = await api<{ resourceTemplates?: Template[]; resources?: unknown[] }>("/api/mcp/resources");
    const templates = payload.resourceTemplates ?? [];
    if (templates.length === 0) desc.textContent = "No resource templates. Start MCP first.";
    for (const tpl of templates) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = tpl.uriTemplate;
      btn.addEventListener("click", () => {
        selected = tpl;
        desc.textContent = `${tpl.uriTemplate}${tpl.description ? ` — ${tpl.description}` : ""}`;
        fields.replaceChildren();
        for (const name of paramNames(tpl.uriTemplate)) {
          const label = document.createElement("label");
          label.textContent = name;
          const input = document.createElement("input");
          input.dataset.param = name;
          if (name === "campaignId") input.placeholder = "campaign id";
          label.append(input);
          fields.append(label);
          if (name === "campaignId") attachCampaignPicker(input);
        }
      });
      listEl.append(btn);
    }
  } catch (error) {
    desc.textContent = error instanceof Error ? error.message : String(error);
    desc.classList.add("error");
  }

  const read = container.querySelector("#res-read") as HTMLButtonElement;
  submitOnEnter(container.querySelector(".detail")!, () => read.click());
  read.addEventListener("click", async () => {
    if (!selected) return;
    const params: Record<string, string> = {};
    for (const input of fields.querySelectorAll<HTMLInputElement>("[data-param]")) {
      params[input.dataset.param!] = input.value;
    }
    try {
      const uri = fill(selected.uriTemplate, params);
      const body = await api("/api/mcp/resources/read", {
        method: "POST",
        body: JSON.stringify({ uri }),
      });
      view = { ok: true, body };
      render();
    } catch (error) {
      view = { ok: false, message: error instanceof Error ? error.message : String(error) };
      render();
    }
  });
}
