/**
 * Starts a spec pass for a GitHub issue labeled `spec required` / `spec-required`.
 * Used by `.github/workflows/spec-on-label.yml`.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SPEC_LABELS = new Set(["spec required", "spec-required"]);

/** @type {readonly number[]} */
export const DEFAULT_WEBHOOK_RETRY_DELAYS_MS = [5000, 15000, 45000];

const WEBHOOK_BODY_LOG_MAX = 500;

/**
 * @param {number} status
 * @param {string} bodyText
 */
export function isRetryableWebhookResponse(status, bodyText) {
  if (status >= 500) return true;
  if (status === 429) return true;
  if (status === 400 && /internal error/i.test(bodyText)) return true;
  return false;
}

/**
 * @param {string} text
 */
function truncateWebhookBody(text) {
  return text.slice(0, WEBHOOK_BODY_LOG_MAX);
}

/**
 * @param {object} opts
 * @param {typeof fetch} opts.fetchImpl
 * @param {string} opts.webhookUrl
 * @param {string} opts.webhookToken
 * @param {string} opts.body
 * @param {readonly number[]} [opts.retryDelaysMs]
 * @param {(ms: number) => Promise<void>} [opts.sleepMs]
 * @param {(message: string) => void} [opts.logRetry]
 */
export async function postAutomationWebhookWithRetries(opts) {
  const delays = opts.retryDelaysMs ?? DEFAULT_WEBHOOK_RETRY_DELAYS_MS;
  const sleepMs = opts.sleepMs ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const logRetry = opts.logRetry ?? ((message) => console.error(message));
  const maxAttempts = delays.length + 1;

  /** @type {Error | undefined} */
  let lastNetworkError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await opts.fetchImpl(opts.webhookUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.webhookToken}`,
          "content-type": "application/json",
        },
        body: opts.body,
      });
      const text = await response.text();
      if (response.ok) {
        return { response, text };
      }

      const truncated = truncateWebhookBody(text);
      const isLastAttempt = attempt >= maxAttempts - 1;
      if (!isRetryableWebhookResponse(response.status, text) || isLastAttempt) {
        throw new Error(`Automation webhook ${response.status}: ${truncated}`);
      }

      logRetry(
        `Automation webhook attempt ${attempt + 1} failed (${response.status}); retrying in ${delays[attempt]}ms: ${truncated}`,
      );
      await sleepMs(delays[attempt]);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Automation webhook ")) {
        throw err;
      }
      lastNetworkError = err instanceof Error ? err : new Error(String(err));
      const isLastAttempt = attempt >= maxAttempts - 1;
      if (isLastAttempt) {
        throw lastNetworkError;
      }
      logRetry(
        `Automation webhook attempt ${attempt + 1} failed (network); retrying in ${delays[attempt]}ms: ${lastNetworkError.message}`,
      );
      await sleepMs(delays[attempt]);
    }
  }

  throw lastNetworkError ?? new Error("Automation webhook failed after retries");
}

/**
 * @param {string | undefined | null} name
 */
export function isSpecRequiredLabel(name) {
  return SPEC_LABELS.has(String(name ?? "").trim().toLowerCase());
}

/**
 * GitHub sends `repository.default_branch` as a name (`main`). The prompt needs a remote ref.
 * @param {string | undefined | null} name
 */
export function specTargetBranch(name) {
  const branch = String(name ?? "").trim();
  if (!branch) return "origin/main";
  if (branch.startsWith("origin/")) return branch;
  return `origin/${branch}`;
}

/**
 * @param {{ issueNumber: number, issueUrl: string, title: string, targetBranch: string }} input
 */
export function specPassPrompt(input) {
  return [
    `Pull ${input.targetBranch} and follow \`.cursor/prompts/spec.md\` for GitHub issue #${input.issueNumber} on horribleCodes/gardener.`,
    `Issue URL: ${input.issueUrl}`,
    `Title: ${input.title}`,
  ].join("\n");
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {{ number: number, html_url: string, title: string, pull_request?: unknown, state?: string }} opts.issue
 * @param {string} opts.repositoryUrl
 * @param {string} [opts.targetBranch] Repository default branch (`main`) or an `origin/` ref.
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {readonly number[]} [opts.retryDelaysMs]
 * @param {(ms: number) => Promise<void>} [opts.sleepMs]
 * @param {(message: string) => void} [opts.logRetry]
 */
export async function startSpecPass(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const env = opts.env ?? process.env;
  const issue = opts.issue;

  if (issue.pull_request) {
    return { ok: true, skipped: "pull_request" };
  }
  if (issue.state === "closed") {
    return { ok: true, skipped: "closed" };
  }
  if (!isSpecRequiredLabel(opts.label)) {
    return { ok: true, skipped: "label" };
  }

  const prompt = specPassPrompt({
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    title: issue.title,
    targetBranch: specTargetBranch(opts.targetBranch),
  });

  const webhookUrl = env.CURSOR_AUTOMATION_WEBHOOK_URL?.trim();
  const webhookToken = env.CURSOR_AUTOMATION_WEBHOOK_TOKEN?.trim();
  if (webhookUrl && webhookToken) {
    const { text } = await postAutomationWebhookWithRetries({
      fetchImpl,
      webhookUrl,
      webhookToken,
      body: JSON.stringify({
        // Automations inject `context` into the Cloud Agent prompt.
        context: prompt,
        issue: { number: issue.number, html_url: issue.html_url, title: issue.title },
        repository: opts.repositoryUrl,
        label: opts.label,
      }),
      retryDelaysMs: opts.retryDelaysMs,
      sleepMs: opts.sleepMs,
      logRetry: opts.logRetry,
    });
    /** @type {Record<string, any>} */
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    const agentId =
      parsed.backgroundComposerId ?? parsed.agent?.id ?? parsed.id ?? null;
    if (!agentId || parsed.success === false) {
      throw new Error(
        `Automation webhook did not start a Cloud Agent: ${text.slice(0, 500)}`,
      );
    }
    const agentUrl =
      parsed.agent?.url ??
      parsed.url ??
      parsed.target?.url ??
      `https://cursor.com/agents/${agentId}`;
    return { ok: true, mode: "webhook", agentUrl };
  }

  throw new Error(
    "No Cursor credentials. Set GitHub Actions secrets CURSOR_AUTOMATION_WEBHOOK_URL and CURSOR_AUTOMATION_WEBHOOK_TOKEN.",
  );
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const raw = (await readStdin()).trim();
  if (!raw) {
    throw new Error("Expected a GitHub issues event JSON on stdin.");
  }
  const event = JSON.parse(raw);
  const result = await startSpecPass({
    label: event.label?.name ?? "",
    issue: event.issue,
    repositoryUrl: event.repository?.html_url ?? "",
    targetBranch: event.repository?.default_branch,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedAsCli =
  Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedAsCli) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
