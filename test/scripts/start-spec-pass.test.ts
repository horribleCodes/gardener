import { afterEach, expect, test } from "vitest";
import {
  isSpecRequiredLabel,
  specPassPrompt,
  startSpecPass,
} from "../../scripts/start-spec-pass.mjs";

afterEach(() => {
  delete process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_AUTOMATION_WEBHOOK_URL;
  delete process.env.CURSOR_AUTOMATION_WEBHOOK_TOKEN;
});

test("matches spec required label spellings", () => {
  expect(isSpecRequiredLabel("spec required")).toBe(true);
  expect(isSpecRequiredLabel("spec-required")).toBe(true);
  expect(isSpecRequiredLabel(" Spec Required ")).toBe(true);
  expect(isSpecRequiredLabel("spec ready")).toBe(false);
  expect(isSpecRequiredLabel("enhancement")).toBe(false);
});

test("prompt names the issue and living spec procedure", () => {
  const text = specPassPrompt({
    issueNumber: 41,
    issueUrl: "https://github.com/horribleCodes/gardener/issues/41",
    title: "Direct interest edge with an explicit nature",
  });
  expect(text).toContain("issue #41");
  expect(text).toContain("https://github.com/horribleCodes/gardener/issues/41");
  expect(text).toContain(".cursor/prompts/spec.md");
  expect(text).toContain("horribleCodes/gardener");
  expect(text).toContain("origin/main");
  expect(text).toContain("draft");
  expect(text).toContain("Related to #41");
  expect(text).not.toMatch(/Grok/i);
});

test("skips issues that are pull requests", async () => {
  const result = await startSpecPass({
    label: "spec required",
    issue: { number: 9, html_url: "https://example.test/9", title: "pr", pull_request: {} },
    repositoryUrl: "https://github.com/horribleCodes/gardener",
    fetchImpl: async () => {
      throw new Error("must not call fetch");
    },
  });
  expect(result).toEqual({ ok: true, skipped: "pull_request" });
});

test("skips other labels", async () => {
  const result = await startSpecPass({
    label: "enhancement",
    issue: { number: 41, html_url: "https://example.test/41", title: "x" },
    repositoryUrl: "https://github.com/horribleCodes/gardener",
    fetchImpl: async () => {
      throw new Error("must not call fetch");
    },
  });
  expect(result).toEqual({ ok: true, skipped: "label" });
});

test("starts a cloud agent when CURSOR_API_KEY is set", async () => {
  process.env.CURSOR_API_KEY = "test-key";
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await startSpecPass({
    label: "spec required",
    issue: {
      number: 41,
      html_url: "https://github.com/horribleCodes/gardener/issues/41",
      title: "Direct interest edge",
    },
    repositoryUrl: "https://github.com/horribleCodes/gardener",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          agent: { id: "bc-test", url: "https://cursor.com/agents/bc-test" },
          run: { id: "run-test" },
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://api.cursor.com/v1/agents");
  const body = JSON.parse(String(calls[0].init.body));
  expect(body.prompt.text).toContain("issue #41");
  expect(body.repos[0]).toEqual({
    url: "https://github.com/horribleCodes/gardener",
    startingRef: "main",
  });
  expect(body.autoCreatePR).toBe(false);
  expect(result).toEqual({
    ok: true,
    mode: "api",
    agentUrl: "https://cursor.com/agents/bc-test",
  });
});

test("posts context to the automation webhook when only webhook secrets are set", async () => {
  process.env.CURSOR_AUTOMATION_WEBHOOK_URL = "https://api2.cursor.sh/automations/webhook/abc";
  process.env.CURSOR_AUTOMATION_WEBHOOK_TOKEN = "wh-token\n";
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await startSpecPass({
    label: "spec-required",
    issue: {
      number: 54,
      html_url: "https://github.com/horribleCodes/gardener/issues/54",
      title: "Campaign flags",
    },
    repositoryUrl: "https://github.com/horribleCodes/gardener",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          success: true,
          backgroundComposerId: "bc-spec-54",
          runUuid: "run-spec-54",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://api2.cursor.sh/automations/webhook/abc");
  const headers = new Headers(calls[0].init.headers);
  expect(headers.get("authorization")).toBe("Bearer wh-token");
  const body = JSON.parse(String(calls[0].init.body));
  expect(body.context).toContain("issue #54");
  expect(body.context).toContain(".cursor/prompts/spec.md");
  expect(body.context).toContain("Related to #54");
  expect(body.issue.number).toBe(54);
  expect(body.prompt).toBeUndefined();
  expect(result).toEqual({
    ok: true,
    mode: "webhook",
    agentUrl: "https://cursor.com/agents/bc-spec-54",
  });
});

test("uses the webhook when webhook secrets are set even if CURSOR_API_KEY is also set", async () => {
  process.env.CURSOR_API_KEY = "test-key";
  process.env.CURSOR_AUTOMATION_WEBHOOK_URL = "https://api2.cursor.sh/automations/webhook/abc";
  process.env.CURSOR_AUTOMATION_WEBHOOK_TOKEN = "wh-token";
  const calls: string[] = [];
  const result = await startSpecPass({
    label: "spec required",
    issue: {
      number: 67,
      html_url: "https://github.com/horribleCodes/gardener/issues/67",
      title: "Remove campaign",
    },
    repositoryUrl: "https://github.com/horribleCodes/gardener",
    fetchImpl: async (url, init) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({ success: true, backgroundComposerId: "bc-spec-67" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  expect(calls).toEqual(["https://api2.cursor.sh/automations/webhook/abc"]);
  expect(result.mode).toBe("webhook");
});

test("fails when the webhook returns 200 without a started agent", async () => {
  process.env.CURSOR_AUTOMATION_WEBHOOK_URL = "https://api2.cursor.sh/automations/webhook/abc";
  process.env.CURSOR_AUTOMATION_WEBHOOK_TOKEN = "wh-token";
  await expect(
    startSpecPass({
      label: "spec required",
      issue: {
        number: 67,
        html_url: "https://github.com/horribleCodes/gardener/issues/67",
        title: "Remove campaign",
      },
      repositoryUrl: "https://github.com/horribleCodes/gardener",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    }),
  ).rejects.toThrow(/did not start a Cloud Agent/i);
});

test("skips closed issues", async () => {
  const result = await startSpecPass({
    label: "spec required",
    issue: {
      number: 26,
      html_url: "https://example.test/26",
      title: "closed",
      state: "closed",
    },
    repositoryUrl: "https://github.com/horribleCodes/gardener",
    fetchImpl: async () => {
      throw new Error("must not call fetch");
    },
  });
  expect(result).toEqual({ ok: true, skipped: "closed" });
});

test("fails when no Cursor secrets are configured", async () => {
  await expect(
    startSpecPass({
      label: "spec required",
      issue: { number: 1, html_url: "https://example.test/1", title: "x" },
      repositoryUrl: "https://github.com/horribleCodes/gardener",
      fetchImpl: async () => new Response("", { status: 200 }),
    }),
  ).rejects.toThrow(/CURSOR_API_KEY|CURSOR_AUTOMATION_WEBHOOK/);
});

test("CLI reads a GitHub issues event from stdin", async () => {
  const { spawnSync } = await import("node:child_process");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const script = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/start-spec-pass.mjs");
  const skipEvent = {
    label: { name: "enhancement" },
    issue: {
      number: 7,
      html_url: "https://github.com/horribleCodes/gardener/issues/7",
      title: "CLI",
    },
    repository: { html_url: "https://github.com/horribleCodes/gardener" },
  };
  const proc = spawnSync(process.execPath, [script], {
    input: JSON.stringify(skipEvent),
    encoding: "utf8",
    env: { ...process.env },
  });
  expect(proc.status).toBe(0);
  expect(JSON.parse(proc.stdout)).toEqual({ ok: true, skipped: "label" });
});
