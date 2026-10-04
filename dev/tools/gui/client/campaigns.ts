import { api } from "./api";
import { campaignMenuRows, type CampaignOption } from "./campaign-list";

let options: CampaignOption[] = [];
const listeners = new Set<() => void>();
let chain: Promise<void> = Promise.resolve();

export function getCampaigns(): CampaignOption[] {
  return options;
}

export function subscribeCampaigns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function refreshCampaigns(): void {
  chain = chain.then(load, load);
}

async function load(): Promise<void> {
  try {
    const body = await api<{ campaigns?: CampaignOption[] }>("/api/campaigns");
    if (!Array.isArray(body.campaigns)) return;
    options = body.campaigns;
    for (const listener of listeners) listener();
  } catch {
    // Keep the previous list. Do not alert.
  }
}

export function attachCampaignPicker(input: HTMLInputElement): void {
  input.parentElement?.classList.add("campaign-anchor");
  const menu = document.createElement("div");
  menu.className = "campaign-menu hidden";
  menu.setAttribute("role", "listbox");
  input.insertAdjacentElement("afterend", menu);
  input.setAttribute("aria-haspopup", "listbox");

  const close = () => {
    menu.classList.add("hidden");
    input.setAttribute("aria-expanded", "false");
  };

  const render = () => {
    menu.replaceChildren();
    const rows = campaignMenuRows(getCampaigns());
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "schema-meta";
      empty.textContent = "No campaigns";
      menu.append(empty);
      return;
    }
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "campaign-option";
      button.textContent = row.label;
      button.setAttribute("role", "option");
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        input.value = row.id;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        close();
      });
      menu.append(button);
    }
  };

  const open = () => {
    refreshCampaigns();
    menu.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
    render();
  };

  input.addEventListener("focus", open);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  const unsubscribe = subscribeCampaigns(() => {
    if (!input.isConnected) {
      unsubscribe();
      return;
    }
    if (!menu.classList.contains("hidden")) render();
  });

  const onDocClick = (event: MouseEvent) => {
    if (!input.isConnected) {
      document.removeEventListener("click", onDocClick);
      unsubscribe();
      return;
    }
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (target === input || menu.contains(target)) return;
    close();
  };
  document.addEventListener("click", onDocClick);
  close();
}
