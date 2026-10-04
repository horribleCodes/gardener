import { api } from "../api";
import { attachCampaignPicker } from "../campaigns";
import { submitOnEnter } from "../submit-key";

type Prompt = {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; required?: boolean; description?: string }>;
};

export async function mountPromptsTab(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="split">
      <div id="prompt-list" class="list"></div>
      <div class="detail">
        <p id="prompt-desc" class="hint">Select a prompt.</p>
        <div id="prompt-fields" class="fields"></div>
        <button id="prompt-run" type="button">Run</button>
        <pre id="prompt-result" class="json"></pre>
      </div>
    </div>`;

  const listEl = container.querySelector("#prompt-list")!;
  const desc = container.querySelector("#prompt-desc")!;
  const fields = container.querySelector("#prompt-fields") as HTMLElement;
  const result = container.querySelector("#prompt-result")!;
  let selected: Prompt | undefined;

  try {
    const payload = await api<{ prompts: Prompt[] }>("/api/mcp/prompts");
    for (const prompt of payload.prompts) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = prompt.name;
      btn.addEventListener("click", () => {
        selected = prompt;
        desc.textContent = `${prompt.name}: ${prompt.description ?? ""}`;
        fields.replaceChildren();
        for (const arg of prompt.arguments ?? []) {
          const label = document.createElement("label");
          label.textContent = `${arg.name}${arg.required ? " (required)" : ""}`;
          const input = document.createElement("input");
          input.dataset.arg = arg.name;
          if (arg.name === "campaignId") input.placeholder = "";
          label.append(input);
          fields.append(label);
          if (arg.name === "campaignId") attachCampaignPicker(input);
        }
      });
      listEl.append(btn);
    }
  } catch (error) {
    desc.textContent = error instanceof Error ? error.message : String(error);
    desc.classList.add("error");
  }

  const run = container.querySelector("#prompt-run") as HTMLButtonElement;
  submitOnEnter(container.querySelector(".detail")!, () => run.click());
  run.addEventListener("click", async () => {
    if (!selected) return;
    const args: Record<string, string> = {};
    for (const input of fields.querySelectorAll<HTMLInputElement>("[data-arg]")) {
      if (input.value) args[input.dataset.arg!] = input.value;
    }
    try {
      const body = await api("/api/mcp/prompts/get", {
        method: "POST",
        body: JSON.stringify({ name: selected.name, arguments: args }),
      });
      result.className = "json";
      result.textContent = JSON.stringify(body, null, 2);
    } catch (error) {
      result.className = "json error";
      result.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}
