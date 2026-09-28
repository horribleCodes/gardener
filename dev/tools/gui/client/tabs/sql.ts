import { api } from "../api";

export function mountSqlTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="detail">
      <textarea id="sql-text" class="code" spellcheck="false">SELECT name FROM sqlite_master WHERE type='table'</textarea>
      <div>
        <button id="sql-run" type="button">Run</button>
        <button id="sql-toggle" type="button">Show JSON</button>
      </div>
      <div id="sql-table"></div>
      <pre id="sql-json" class="json hidden"></pre>
    </div>`;

  const text = container.querySelector("#sql-text") as HTMLTextAreaElement;
  const tableHost = container.querySelector("#sql-table") as HTMLElement;
  const jsonEl = container.querySelector("#sql-json") as HTMLElement;
  const toggle = container.querySelector("#sql-toggle") as HTMLButtonElement;
  let showJson = false;

  const render = (body: { columns?: string[]; rows?: unknown[][]; text?: string; error?: string }) => {
    jsonEl.textContent = JSON.stringify(body, null, 2);
    tableHost.replaceChildren();
    if (body.columns && body.rows) {
      const table = document.createElement("table");
      const head = document.createElement("tr");
      for (const col of body.columns) {
        const th = document.createElement("th");
        th.textContent = col;
        head.append(th);
      }
      table.append(head);
      for (const row of body.rows) {
        const tr = document.createElement("tr");
        for (const cell of row) {
          const td = document.createElement("td");
          td.textContent = cell == null ? "" : String(cell);
          tr.append(td);
        }
        table.append(tr);
      }
      tableHost.append(table);
    } else {
      tableHost.textContent = body.text ?? body.error ?? "";
    }
    jsonEl.classList.toggle("hidden", !showJson);
    tableHost.classList.toggle("hidden", showJson);
  };

  toggle.addEventListener("click", () => {
    showJson = !showJson;
    toggle.textContent = showJson ? "Show table" : "Show JSON";
    jsonEl.classList.toggle("hidden", !showJson);
    tableHost.classList.toggle("hidden", showJson);
  });

  container.querySelector("#sql-run")!.addEventListener("click", async () => {
    try {
      const body = await api<{ columns?: string[]; rows?: unknown[][]; text?: string }>("/api/sql", {
        method: "POST",
        body: JSON.stringify({ sql: text.value }),
      });
      render(body);
    } catch (error) {
      render({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
