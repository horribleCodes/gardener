import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { RuleError } from "../domain/types.js";
import { quoteChange } from "../rules/cost.js";
import { catalogRowsAt } from "../tables/catalog.js";
import {
  cultIncome,
  explainRoll,
  getCourt,
  getFaction,
  interestMap,
  relevantFeatures,
} from "../queries/detail.js";
import { worldBrief, rumorLines } from "../queries/rumors.js";
import { beginChange, commitResources, applyOutcome, withdrawInfluence, assessWithdrawal, resolveWithdrawal, expandChange } from "../services/change.js";
import {
  createCampaign,
  createPlace,
  createGodbound,
  seedCampaign,
  createFaction,
  createCourt,
  fitBlank,
  createCharacter,
  createFact,
  ensureSetpiece,
  createChallenge,
  recordDeed,
  recordChallengeOutcome,
  createChampion,
  recordShatter,
  swayCourt,
  formCult,
  setTheology,
  setDivinity,
  setPower,
} from "../services/populate.js";
import {
  runFactionTurn,
  factionAction,
  resolveAttack,
  spendInterest,
  advanceMonthForCampaign,
  listHooks,
  type FactionAction,
} from "../services/turn.js";
import { openDb } from "../store/db.js";
import type { ServiceResult } from "../services/util.js";
import { mcpToolResult, runTool, toEnvelope } from "./envelope.js";

const scopeZ = z.enum(["village", "city", "region", "nation", "realm"]);
const magnitudeZ = z.enum(["plausible", "improbable", "impossible", "vast"]);
const powerZ = z.number().int().min(1).max(5);
const fillZ = z.enum(["require", "missing", "blank"]).optional();

type ZodShape = Record<string, z.ZodTypeAny>;
type ToolHandler = (
  args: Record<string, unknown>,
) => ReturnType<typeof mcpToolResult> | Promise<ReturnType<typeof mcpToolResult>>;

function dbTool(fn: (args: any) => ServiceResult<unknown>): ToolHandler {
  return (args) => runTool(() => fn(args));
}

export function buildServer(dbPath: string): McpServer {
  const db = openDb(dbPath);
  const server = new McpServer({ name: "godbound-world", version: "0.1.0" });
  const reg = (
    name: string,
    config: { description?: string; inputSchema?: ZodShape },
    handler: ToolHandler,
  ) => {
    server.registerTool(name, config as Parameters<McpServer["registerTool"]>[1], handler as any);
  };

  reg(
    "quote_change",
    {
      description: "Quote the dominion and influence cost for a proposed change",
      inputSchema: {
        scope: scopeZ,
        magnitude: magnitudeZ,
        wardRatings: z.array(z.number().int().min(1).max(20)).default([]),
        resisterRatings: z.array(z.number().int().min(1)).default([]),
        kind: z
          .enum([
            "feature",
            "fact",
            "problem_mitigation",
            "creature_population",
            "champion",
            "other",
          ])
          .optional(),
        petty: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const quote = quoteChange({
          scope: args.scope as import("../domain/types.js").Scope,
          magnitude: args.magnitude as import("../domain/types.js").Magnitude,
          kind:
            (args.kind as
              | "feature"
              | "fact"
              | "problem_mitigation"
              | "creature_population"
              | "champion"
              | "other"
              | undefined) ?? "feature",
          wardRatings: (args.wardRatings as number[] | undefined) ?? [],
          resisterRatings: (args.resisterRatings as number[] | undefined) ?? [],
          petty: args.petty as boolean | undefined,
        });
        return mcpToolResult(toEnvelope({ ok: true, data: quote }));
      } catch (error) {
        if (error instanceof RuleError) {
          return mcpToolResult({
            ok: false,
            error: { code: error.code, message: error.message, details: error.details },
          });
        }
        throw error;
      }
    },
  );

  reg(
    "create_campaign",
    {
      description: "Create an empty campaign",
      inputSchema: { name: z.string(), rngSeed: z.number().int().optional(), nameLists: z.record(z.array(z.string())).optional() },
    },
    dbTool((a) => createCampaign(db, a)),
  );

  reg(
    "seed_campaign",
    {
      description: "Create a campaign from an outline",
      inputSchema: {
        name: z.string(),
        fill: fillZ,
        seed: z.number().int().optional(),
        linkInterests: z.boolean().optional(),
        rulingCourts: z.boolean().optional(),
        outline: z
          .object({
            places: z
              .array(
                z.object({
                  key: z.string(),
                  name: z.string(),
                  scope: scopeZ.optional(),
                  parentKey: z.string().optional(),
                  cultureId: z.string().optional(),
                }),
              )
              .optional(),
            factions: z
              .array(
                z.object({
                  key: z.string(),
                  name: z.string(),
                  homePlaceKey: z.string().optional(),
                  power: powerZ.optional(),
                  behavior: z.string().optional(),
                  courtType: z.string().optional(),
                  neighborKeys: z.array(z.string()).optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      },
    },
    dbTool((a) => seedCampaign(db, a)),
  );

  reg(
    "create_place",
    {
      description: "Create a place",
      inputSchema: {
        campaignId: z.string(),
        name: z.string(),
        scope: scopeZ,
        parentPlaceId: z.string().optional(),
        cultureId: z.string().optional(),
        wards: z.array(z.object({ rating: z.number().int() })).optional(),
      },
    },
    dbTool((a) => createPlace(db, a)),
  );

  reg(
    "create_godbound",
    {
      description: "Create a Godbound PC",
      inputSchema: {
        campaignId: z.string(),
        name: z.string(),
        level: z.number().int().min(1),
        words: z.array(z.string()).optional(),
        influence: z.number().int().optional(),
        dominion: z.number().int().optional(),
        wealth: z.number().int().optional(),
        divinity: z.enum(["none", "free", "cult"]).optional(),
      },
    },
    dbTool((a) => createGodbound(db, a)),
  );

  reg(
    "advance_month",
    { description: "Close an open turn if needed and advance the calendar", inputSchema: { campaignId: z.string() } },
    dbTool((a) => advanceMonthForCampaign(db, a.campaignId)),
  );

  reg(
    "create_faction",
    {
      description: "Create a faction",
      inputSchema: {
        campaignId: z.string(),
        name: z.string(),
        power: powerZ,
        behavior: z.string(),
        cohesion: z.number().int().optional(),
        dominion: z.number().int().optional(),
        origin: z.enum(["existing", "forged"]).optional(),
        control: z.enum(["npc", "player"]).optional(),
        homePlaceId: z.string().optional(),
        fill: fillZ,
        seed: z.number().int().optional(),
        pressure: z.enum(["prosperous", "strained", "crisis"]).optional(),
        crisisBand: z.enum(["half", "three-quarter"]).optional(),
        featureCount: z.number().int().optional(),
      },
    },
    dbTool((a) => createFaction(db, a)),
  );

  reg(
    "create_court",
    {
      description: "Generate and persist a court",
      inputSchema: {
        campaignId: z.string(),
        fill: fillZ,
        seed: z.number().int().optional(),
        placeId: z.string().optional(),
        rulesFactionId: z.string().optional(),
        type: z.string().optional(),
        powerStructure: z.string().optional(),
        conflict: z.string().optional(),
        atmosphere: z.string().optional(),
        majorCount: z.number().int().optional(),
        minorCount: z.number().int().optional(),
        names: z.array(z.string()).optional(),
      },
    },
    dbTool((a) => createCourt(db, a)),
  );

  reg(
    "fit_blank",
    {
      description: "Name blank court or character rows",
      inputSchema: {
        campaignId: z.string(),
        courtId: z.string().optional(),
        characterId: z.string().optional(),
        fittedSummary: z.string().optional(),
      },
    },
    dbTool((a) => fitBlank(db, a)),
  );

  reg(
    "create_character",
    {
      description: "Create a character",
      inputSchema: {
        campaignId: z.string(),
        role: z.string(),
        fill: fillZ,
        name: z.string().optional(),
        courtId: z.string().optional(),
        factionId: z.string().optional(),
        side: z.string().optional(),
      },
    },
    dbTool((a) => createCharacter(db, a)),
  );

  reg(
    "create_fact",
    {
      description: "Record a fact",
      inputSchema: {
        campaignId: z.string(),
        subject: z.enum(["place", "faction", "character", "court"]),
        subjectId: z.string(),
        fill: fillZ,
        statement: z.string().optional(),
        kind: z.string().optional(),
        visibility: z.string().optional(),
      },
    },
    dbTool((a) => createFact(db, a)),
  );

  reg(
    "ensure_setpiece",
    {
      description: "Idempotent setpiece ensure",
      inputSchema: {
        campaignId: z.string(),
        key: z.string(),
        need: z.enum(["court", "challenge", "character", "fact", "problem_face"]),
        placeId: z.string().optional(),
        changeId: z.string().optional(),
        problemId: z.string().optional(),
        courtId: z.string().optional(),
        fill: fillZ,
        seed: z.number().int().optional(),
      },
    },
    dbTool((a) => ensureSetpiece(db, a)),
  );

  reg(
    "create_challenge",
    {
      description: "Attach a challenge card to a change",
      inputSchema: {
        changeId: z.string(),
        kind: z.string(),
        text: z.string().optional(),
        fill: fillZ,
        seed: z.number().int().optional(),
      },
    },
    dbTool((a) => createChallenge(db, a)),
  );

  reg(
    "begin_change",
    {
      description: "Open a PC-owned change project",
      inputSchema: {
        campaignId: z.string(),
        owner: z.enum(["pc", "faction"]),
        scope: scopeZ,
        magnitude: magnitudeZ,
        kind: z.string(),
        factionId: z.string().optional(),
        placeIds: z.array(z.string()).optional(),
        featureText: z.string().optional(),
        godboundId: z.string().optional(),
        petty: z.boolean().optional(),
      },
    },
    dbTool((a) => beginChange(db, a)),
  );

  reg(
    "commit_resources",
    {
      description: "Commit influence or wealth to a change",
      inputSchema: {
        changeId: z.string(),
        godboundId: z.string(),
        influence: z.number().int(),
        wealthSpent: z.number().int().optional(),
        backlash: z.string().optional(),
        featureText: z.string().optional(),
      },
    },
    dbTool((a) => commitResources(db, a)),
  );

  reg(
    "withdraw_influence",
    {
      description: "Withdraw committed influence from a change",
      inputSchema: { changeId: z.string(), godboundId: z.string() },
    },
    dbTool((a) => withdrawInfluence(db, a)),
  );

  reg(
    "assess_withdrawal",
    {
      description: "Preview withdrawal risks",
      inputSchema: { changeId: z.string(), event: z.boolean().optional() },
    },
    dbTool((a) => assessWithdrawal(db, a)),
  );

  reg(
    "resolve_withdrawal",
    {
      description: "Resolve a decaying change",
      inputSchema: {
        changeId: z.string(),
        choice: z.enum(["undo", "leave_fragile", "stable"]),
      },
    },
    dbTool((a) => resolveWithdrawal(db, a)),
  );

  reg(
    "record_deed",
    { description: "Record a mighty deed toward a change", inputSchema: { changeId: z.string() } },
    dbTool((a) => recordDeed(db, a)),
  );

  reg(
    "record_challenge_outcome",
    {
      description: "Record a challenge card outcome",
      inputSchema: { challengeId: z.string(), overcome: z.boolean() },
    },
    dbTool((a) => recordChallengeOutcome(db, a)),
  );

  reg(
    "expand_change",
    {
      description: "Expand an active change scope or magnitude",
      inputSchema: {
        changeId: z.string(),
        scope: scopeZ,
        magnitude: magnitudeZ,
        kind: z.string().optional(),
        placeIds: z.array(z.string()).optional(),
        influence: z.number().int().optional(),
        dominion: z.number().int().optional(),
        godboundId: z.string().optional(),
        childStatement: z.string(),
      },
    },
    dbTool((a) => expandChange(db, a)),
  );

  reg(
    "create_champion",
    {
      description: "Spend dominion to create a champion",
      inputSchema: {
        campaignId: z.string(),
        godboundId: z.string(),
        level: z.number().int(),
        loyal: z.boolean().optional(),
      },
    },
    dbTool((a) => createChampion(db, a)),
  );

  reg(
    "apply_outcome",
    {
      description: "Apply a scripted adventure outcome",
      inputSchema: {
        campaignId: z.string(),
        factionId: z.string(),
        removeFeatureId: z.string().optional(),
        removeFeaturePartId: z.string().optional(),
        reduceProblemId: z.string().optional(),
        reduceBy: z.number().int().optional(),
        addFeatureText: z.string().optional(),
        backlash: z.string().optional(),
      },
    },
    dbTool((a) => applyOutcome(db, a)),
  );

  reg(
    "sway_court",
    {
      description: "Record court favor or control",
      inputSchema: {
        campaignId: z.string(),
        courtId: z.string(),
        targetType: z.enum(["godbound", "faction"]),
        targetId: z.string(),
        mode: z.enum(["favor", "control"]),
        prepared: z.boolean().optional(),
        statement: z.string().optional(),
      },
    },
    dbTool((a) => swayCourt(db, a)),
  );

  reg(
    "form_cult",
    {
      description: "Bind a Godbound to a cult faction",
      inputSchema: {
        campaignId: z.string(),
        godboundId: z.string(),
        featureText: z.string(),
        harshness: z.string().optional(),
        acknowledged: z.boolean().optional(),
        adoptFactionId: z.string().optional(),
        name: z.string().optional(),
      },
    },
    dbTool((a) => formCult(db, a)),
  );

  reg(
    "set_theology",
    {
      description: "Change cult theology at the cost of power",
      inputSchema: {
        campaignId: z.string(),
        cultFactionId: z.string(),
        harshness: z.string().optional(),
        featureText: z.string().optional(),
      },
    },
    dbTool((a) => setTheology(db, a)),
  );

  reg(
    "set_divinity",
    {
      description: "Set a Godbound divinity track",
      inputSchema: {
        campaignId: z.string(),
        godboundId: z.string(),
        divinity: z.enum(["none", "free", "cult"]),
        gmOverride: z.boolean().optional(),
      },
    },
    dbTool((a) => setDivinity(db, a)),
  );

  reg(
    "set_power",
    {
      description: "GM set faction power",
      inputSchema: { campaignId: z.string(), factionId: z.string(), power: powerZ },
    },
    dbTool((a) => setPower(db, a as { campaignId: string; factionId: string; power: 1 | 2 | 3 | 4 | 5 })),
  );

  reg(
    "run_faction_turn",
    {
      description: "Run a mechanical faction turn",
      inputSchema: {
        campaignId: z.string(),
        advanceMonth: z.boolean().optional(),
        resume: z.boolean().optional(),
      },
    },
    dbTool((a) => runFactionTurn(db, a)),
  );

  reg(
    "faction_action",
    {
      description: "Take one faction action on the open turn",
      inputSchema: {
        campaignId: z.string(),
        factionId: z.string(),
        action: z.record(z.unknown()),
      },
    },
    dbTool((a) =>
      factionAction(db, {
        campaignId: a.campaignId,
        factionId: a.factionId,
        action: a.action as FactionAction,
      }),
    ),
  );

  reg(
    "resolve_attack",
    {
      description: "Resolve a pending defender choice",
      inputSchema: {
        campaignId: z.string(),
        actionId: z.string(),
        defenderChoice: z.enum(["cohesion", "sacrifice", "problem"]),
        problemId: z.string().optional(),
      },
    },
    dbTool((a) => resolveAttack(db, a)),
  );

  reg(
    "spend_interest",
    {
      description: "Spend interest to modify a contest",
      inputSchema: {
        campaignId: z.string(),
        fromFactionId: z.string(),
        toFactionId: z.string(),
        timing: z.enum(["before", "after", "steal"]),
        modifier: z.number().int(),
        actionId: z.string().optional(),
      },
    },
    dbTool((a) => spendInterest(db, a)),
  );

  reg(
    "record_shatter",
    {
      description: "Record a collapsed faction outcome",
      inputSchema: {
        campaignId: z.string(),
        factionId: z.string(),
        outcome: z.enum(["splintered", "conquered", "abandoned", "other"]),
        statement: z.string(),
        successorFactionIds: z.array(z.string()).optional(),
      },
    },
    dbTool((a) => recordShatter(db, a)),
  );

  reg(
    "get_world_brief",
    { description: "GM world summary", inputSchema: { campaignId: z.string() } },
    async (a) => {
      const brief = worldBrief(db, a.campaignId as string);
      if (!brief) {
        return mcpToolResult({
          ok: false,
          error: { code: "CAMPAIGN_NOT_FOUND", message: "campaign not found", details: {} },
        });
      }
      return mcpToolResult(toEnvelope({ ok: true, data: brief }));
    },
  );

  reg(
    "get_faction",
    { description: "Full faction sheet", inputSchema: { factionId: z.string() } },
    async (a) => {
      const data = getFaction(db, a.factionId as string);
      if (!data) {
        return mcpToolResult({
          ok: false,
          error: { code: "ENTITY_NOT_FOUND", message: "faction not found", details: {} },
        });
      }
      return mcpToolResult(toEnvelope({ ok: true, data }));
    },
  );

  reg(
    "get_court",
    { description: "Court detail", inputSchema: { courtId: z.string() } },
    async (a) => {
      const data = getCourt(db, a.courtId as string);
      if (!data) {
        return mcpToolResult({
          ok: false,
          error: { code: "ENTITY_NOT_FOUND", message: "court not found", details: {} },
        });
      }
      return mcpToolResult(toEnvelope({ ok: true, data }));
    },
  );

  reg(
    "explain_roll",
    { description: "Explain a stored roll", inputSchema: { rollId: z.string() } },
    async (a) => {
      const data = explainRoll(db, a.rollId as string);
      if (!data) {
        return mcpToolResult({
          ok: false,
          error: { code: "ENTITY_NOT_FOUND", message: "roll not found", details: {} },
        });
      }
      return mcpToolResult(toEnvelope({ ok: true, data }));
    },
  );

  reg(
    "list_hooks",
    { description: "List narrative hooks", inputSchema: { campaignId: z.string() } },
    dbTool((a) => listHooks(db, a.campaignId as string)),
  );

  reg(
    "list_rumors",
    { description: "Rumor lines from the latest closed turn", inputSchema: { campaignId: z.string() } },
    async (a) =>
      mcpToolResult(toEnvelope({ ok: true, data: { lines: rumorLines(db, a.campaignId as string) } })),
  );

  reg(
    "decision_makers",
    { description: "Who must agree for a court to act", inputSchema: { courtId: z.string() } },
    async (a) => {
      const court = getCourt(db, a.courtId as string);
      if (!court) {
        return mcpToolResult({
          ok: false,
          error: { code: "ENTITY_NOT_FOUND", message: "court not found", details: {} },
        });
      }
      const rule = court.decisionRule;
      return mcpToolResult(toEnvelope({ ok: true, data: rule }));
    },
  );

  reg(
    "cult_income",
    { description: "Monthly dominion grants", inputSchema: { campaignId: z.string() } },
    async (a) => mcpToolResult(toEnvelope({ ok: true, data: cultIncome(db, a.campaignId as string) })),
  );

  reg(
    "interest_map",
    { description: "Interest edges for a campaign", inputSchema: { campaignId: z.string() } },
    async (a) => mcpToolResult(toEnvelope({ ok: true, data: interestMap(db, a.campaignId as string) })),
  );

  reg(
    "relevant_features",
    {
      description: "Features relevant to a domain contest",
      inputSchema: {
        factionId: z.string(),
        domain: z.string(),
        opposingFeatureId: z.string().optional(),
      },
    },
    async (a) => {
      try {
        const data = relevantFeatures(db, {
          factionId: a.factionId as string,
          domain: a.domain as string,
          opposingFeatureId: a.opposingFeatureId as string | undefined,
        });
        return mcpToolResult(toEnvelope({ ok: true, data }));
      } catch (error) {
        if (error instanceof RuleError) {
          return mcpToolResult({
            ok: false,
            error: { code: error.code, message: error.message, details: error.details },
          });
        }
        throw error;
      }
    },
  );

  const jsonResource = (payload: unknown) => ({
    contents: [{ uri: "ignored", mimeType: "application/json", text: JSON.stringify(payload) }],
  });

  server.registerResource(
    "campaign-brief",
    new ResourceTemplate("world://campaigns/{campaignId}/brief", { list: undefined }),
    { description: "Campaign brief JSON" },
    async (_uri, { campaignId }) => jsonResource(worldBrief(db, campaignId as string)),
  );

  server.registerResource(
    "campaign-faction",
    new ResourceTemplate("world://campaigns/{campaignId}/factions/{factionId}", {
      list: undefined,
    }),
    { description: "Faction JSON" },
    async (_uri, { factionId }) => jsonResource(getFaction(db, factionId as string)),
  );

  server.registerResource(
    "campaign-court",
    new ResourceTemplate("world://campaigns/{campaignId}/courts/{courtId}", { list: undefined }),
    { description: "Court JSON" },
    async (_uri, { courtId }) => jsonResource(getCourt(db, courtId as string)),
  );

  server.registerResource(
    "campaign-turn-latest",
    new ResourceTemplate("world://campaigns/{campaignId}/turns/latest", { list: undefined }),
    { description: "Latest turn rumors and actions" },
    async (_uri, { campaignId }) => {
      const cid = campaignId as string;
      const turn = db
        .prepare(
          `SELECT id FROM turns WHERE campaign_id = ? AND open = 0 ORDER BY sequence DESC LIMIT 1`,
        )
        .get(cid) as { id: string } | undefined;
      const actions = turn
        ? db.prepare("SELECT * FROM actions WHERE turn_id = ?").all(turn.id)
        : [];
      return jsonResource({ rumors: rumorLines(db, cid), actions });
    },
  );

  server.registerResource(
    "campaign-hooks",
    new ResourceTemplate("world://campaigns/{campaignId}/hooks", { list: undefined }),
    { description: "Hook list JSON" },
    async (_uri, { campaignId }) => {
      const hooks = listHooks(db, campaignId as string);
      return jsonResource(hooks.ok ? hooks.data : hooks);
    },
  );

  server.registerResource(
    "catalog-table",
    new ResourceTemplate("world://tables/{path}", { list: undefined }),
    { description: "Generator catalog subtree" },
    async (_uri, { path }) => {
      try {
        return jsonResource(catalogRowsAt(path as string));
      } catch (error) {
        if (error instanceof RuleError) {
          return jsonResource({ ok: false, error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );

  const registerPromptLoose = server.registerPrompt.bind(server) as unknown as (
    name: string,
    config: object,
    handler: (args: { campaignId: string }) => unknown,
  ) => void;
  registerPromptLoose(
    "gm-briefing",
    {
      description: "GM briefing from live JSON only",
      argsSchema: { campaignId: z.string() },
    },
    async ({ campaignId }) => {
      const brief = worldBrief(db, campaignId);
      const hooks = listHooks(db, campaignId);
      const payload = { brief, hooks: hooks.ok ? hooks.data : hooks };
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Narrate only what appears in this JSON. Do not invent dice results.\n${JSON.stringify(payload)}`,
            },
          },
        ],
      };
    },
  );

  registerPromptLoose(
    "faction-turn-narration",
    {
      description: "Narrate the latest faction turn from JSON",
      argsSchema: { campaignId: z.string() },
    },
    async ({ campaignId }) => {
      const turn = db
        .prepare(
          `SELECT id FROM turns WHERE campaign_id = ? AND open = 0 ORDER BY sequence DESC LIMIT 1`,
        )
        .get(campaignId) as { id: string } | undefined;
      const actions = turn
        ? db.prepare("SELECT * FROM actions WHERE turn_id = ?").all(turn.id)
        : [];
      const payload = { rumors: rumorLines(db, campaignId), actions };
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Narrate only what appears in this JSON. Do not invent dice results.\n${JSON.stringify(payload)}`,
            },
          },
        ],
      };
    },
  );

  return server;
}
