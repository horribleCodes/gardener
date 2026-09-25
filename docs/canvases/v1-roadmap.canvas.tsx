import {
  Callout,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  UsageBar,
  computeDAGLayout,
  useHostTheme,
} from "cursor/canvas";

const WAVE_EFFORT = [
  { name: "Strain contract", complexity: 6 },
  { name: "Host now", complexity: 4 },
  { name: "Campaign profile", complexity: 15 },
  { name: "Asset profile", complexity: 14 },
  { name: "Modules", complexity: 11 },
  { name: "Campaign directories", complexity: 3 },
  { name: "Memory and export", complexity: 12 },
  { name: "Smaller tool surface", complexity: 6 },
  { name: "Agents", complexity: 13 },
];

const ROWS: string[][] = [
  ["1", "Schema version checked on open, then migrations", "Strain", "4", "3", "3", "Flags, assets, change log"],
  ["2", "Setpiece links and free-floating challenges", "Strain", "3", "2", "2", "Hooks"],
  ["3", "Willing Remove Interest in unit plans", "Strain", "2", "1", "2", "—"],
  ["4", "MCP config resolved from the install directory", "Host", "2", "2", "2", "Campaign directories"],
  ["5", "Agent card for today’s interest and seed rules", "Host", "4", "2", "4", "Prompt split"],
  ["6", "Campaign flags and the godbound preset", "Profile", "5", "3", "5", "Ashes, cities, assets"],
  ["7", "Place adjacency and reach", "Profile", "3", "3", "4", "Asset Move, city zoom"],
  ["8", "Ashes preset", "Profile", "3", "2", "4", "—"],
  ["9", "Cities preset", "Profile", "3", "3", "3", "—"],
  ["10", "One calamity per place", "Profile", "2", "2", "3", "Sorrow prompts"],
  ["11", "Background actors", "Profile", "2", "2", "3", "—"],
  ["12", "Ratings, treasure, income, upkeep", "Assets", "3", "4", "5", "Asset actions"],
  ["13", "Located assets, bases, and the asset turn", "Assets", "4", "5", "5", "Goals"],
  ["14", "Goals, experience, mechanical tags", "Assets", "3", "3", "4", "—"],
  ["15", "Capability gate", "Assets", "2", "2", "2", "Chart catalogs"],
  ["16", "Chart catalog folders", "Modules", "3", "3", "4", "Module host, chart skills"],
  ["17", "Modules chosen at campaign creation", "Modules", "2", "4", "4", "Live edits, directories, tool groups"],
  ["18", "Add or remove modules during play", "Modules", "1", "4", "3", "—"],
  ["19", "Many campaign directories, one process", "Host", "3", "3", "4", "CLI, browser GUI"],
  ["20", "Append-only change log", "Memory", "3", "3", "4", "Fork, export, live module edits"],
  ["21", "Notes on entities and log rows", "Memory", "2", "2", "3", "—"],
  ["22", "Fork and rewind", "Memory", "4", "4", "4", "—"],
  ["23", "Query export", "Memory", "2", "3", "3", "Retell skill"],
  ["24", "Fewer tools, including an explicit interest edge", "Surface", "3", "3", "4", "Prompts, CLI, skills"],
  ["25", "CLI over the grouped commands", "Surface", "2", "3", "3", "Browser GUI"],
  ["26", "Short prompts per tool cluster", "Agents", "2", "2", "3", "Laya"],
  ["27", "Cursor play and generation skills", "Agents", "2", "3", "3", "—"],
  ["28", "Laya-first server", "Agents", "2", "4", "2", "—"],
  ["29", "Browser GUI for MCP, CLI, and campaign files", "Agents", "2", "4", "4", "—"],
];

const TONES = [
  "danger",
  "warning",
  "info",
  "info",
  "danger",
  "danger",
  "warning",
  "warning",
  "warning",
  "info",
  "info",
  "warning",
  "danger",
  "warning",
  "info",
  "warning",
  "info",
  "info",
  "warning",
  "warning",
  "info",
  "danger",
  "info",
  "warning",
  "info",
  "info",
  "info",
  "info",
  "info",
] as const;

const NODE_LABEL: Record<string, string> = {
  "1": "Schema version",
  "2": "Setpiece links",
  "3": "Willing removal",
  "4": "Relative paths",
  "5": "Agent card",
  "6": "Campaign flags",
  "7": "Place adjacency",
  "8": "Ashes preset",
  "9": "Cities preset",
  "10": "Calamities",
  "11": "Background actors",
  "12": "Ratings",
  "13": "Asset turn",
  "14": "Goals and tags",
  "15": "Capability gate",
  "16": "Chart catalogs",
  "17": "Modules at creation",
  "18": "Live module edits",
  "19": "Campaign directories",
  "20": "Change log",
  "21": "Notes",
  "22": "Fork and rewind",
  "23": "Query export",
  "24": "Fewer tools",
  "25": "CLI",
  "26": "Tool prompts",
  "27": "Cursor skills",
  "28": "Laya server",
  "29": "Browser GUI",
};

/** Prerequisite → dependent. Direct requirements only. */
const DEP_EDGES: Array<{ from: string; to: string }> = [
  { from: "1", to: "6" },
  { from: "1", to: "10" },
  { from: "1", to: "11" },
  { from: "1", to: "19" },
  { from: "1", to: "20" },
  { from: "4", to: "19" },
  { from: "5", to: "26" },
  { from: "6", to: "7" },
  { from: "6", to: "8" },
  { from: "6", to: "9" },
  { from: "6", to: "12" },
  { from: "7", to: "9" },
  { from: "7", to: "13" },
  { from: "12", to: "13" },
  { from: "13", to: "14" },
  { from: "13", to: "15" },
  { from: "15", to: "16" },
  { from: "16", to: "17" },
  { from: "16", to: "27" },
  { from: "17", to: "18" },
  { from: "17", to: "19" },
  { from: "17", to: "24" },
  { from: "19", to: "25" },
  { from: "20", to: "18" },
  { from: "20", to: "21" },
  { from: "20", to: "22" },
  { from: "20", to: "23" },
  { from: "23", to: "27" },
  { from: "24", to: "25" },
  { from: "24", to: "26" },
  { from: "24", to: "27" },
  { from: "25", to: "29" },
  { from: "26", to: "28" },
];

const NODE_W = 156;
const NODE_H = 36;

function DependencyTree() {
  const theme = useHostTheme();
  const layout = computeDAGLayout({
    nodes: Object.keys(NODE_LABEL).map((id) => ({ id })),
    edges: DEP_EDGES,
    direction: "vertical",
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    rankGap: 48,
    nodeGap: 12,
    padding: 4,
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label="Dependency tree of roadmap items. An arrow points from a prerequisite to the item that requires it."
      >
        <defs>
          <marker
            id="roadmap-dep-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill={theme.stroke.primary} />
          </marker>
        </defs>
        {layout.edges.map((edge) => (
          <line
            key={`${edge.from}-${edge.to}`}
            x1={edge.sourceX}
            y1={edge.sourceY}
            x2={edge.targetX}
            y2={edge.targetY}
            stroke={theme.stroke.secondary}
            strokeWidth={1}
            markerEnd="url(#roadmap-dep-arrow)"
          />
        ))}
        {layout.nodes.map((node) => {
          const critical =
            node.id === "1" ||
            node.id === "5" ||
            node.id === "6" ||
            node.id === "13" ||
            node.id === "22";
          return (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx={4}
                fill={theme.bg.elevated}
                stroke={critical ? theme.accent.primary : theme.stroke.primary}
              />
              <text
                x={node.x + 8}
                y={node.y + 23}
                fill={theme.text.primary}
                fontSize={12}
                fontFamily="inherit"
              >
                {`${node.id}  ${NODE_LABEL[node.id]}`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function V1Roadmap() {
  const totalComplexity = WAVE_EFFORT.reduce((sum, wave) => sum + wave.complexity, 0);

  return (
    <Stack gap={20}>
      <Stack gap={6}>
        <H1>Roadmap after v1</H1>
        <Text tone="secondary">
          Twenty-nine items scored 1–5 for criticality, complexity, and impact.
          Five host items from the Sep 24 list sit beside the rules waves. The
          24 Sep 2026 playtest is why the agent card is early and why a shorter
          tool list still has to write an interest edge.
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="5" label="Items that can start now" />
        <Stat value="4" label="Agent card criticality" tone="warning" />
        <Stat value="6" label="Profile items, flags first" tone="info" />
        <Stat value={String(totalComplexity)} label="Complexity points across 29 items" />
      </Grid>

      <Callout tone="warning" title="Write the agent card before the tool list shrinks">
        Item 5 records how seeding, factions, and interest natures work today.
        Item 24 groups the forty-odd tools only after modules exist, and it
        keeps a direct interest-edge write. The Sep 24 playtest missed that
        write and stored a war as facts.
      </Callout>

      <Stack gap={8}>
        <H2>Complexity by wave</H2>
        <UsageBar
          total={totalComplexity}
          topLeftLabel="Complexity points by wave"
          topRightLabel={`${totalComplexity} points`}
          segments={WAVE_EFFORT.map((wave) => ({
            id: wave.name,
            value: wave.complexity,
          }))}
        />
        <Text size="small" tone="tertiary">
          Left to right: Strain contract 6, Host now 4, Campaign profile 15,
          Asset profile 14, Modules 11, Campaign directories 3, Memory and
          export 12, Smaller tool surface 6, Agents 13. Each value is the sum
          of complexity scores in that wave.
        </Text>
      </Stack>

      <Stack gap={8}>
        <H2>What each item requires</H2>
        <Text size="small" tone="secondary">
          An arrow points from a prerequisite to the item that cannot start
          without it. Items 2, 3, 4, and 5 have no prerequisite. Accent borders
          mark criticality 4 or 5. Source: the Gates column and the order
          notes in docs/ROADMAP.md.
        </Text>
        <DependencyTree />
      </Stack>

      <Stack gap={8}>
        <H2>Sequence</H2>
        <Text size="small" tone="secondary">
          Row color marks criticality: high at 4–5, medium at 3. Gates is the
          later work that should not start first.
        </Text>
        <Table
          headers={["#", "Item", "Wave", "Crit", "Cmplx", "Impact", "Gates"]}
          columnAlign={["right", "left", "left", "right", "right", "right", "left"]}
          rows={ROWS}
          rowTone={[...TONES]}
          striped
          stickyHeader
        />
      </Stack>

      <Divider />

      <Grid columns={2} gap={16}>
        <Stack gap={8}>
          <H3>When the five host items start</H3>
          <Text tone="secondary">
            Relative paths and the agent card start now. Campaign directories
            wait for schema version, those paths, and modules chosen at
            creation. Fewer tools wait for that module set, then the CLI, then
            the browser GUI.
          </Text>
          <Row gap={6} wrap>
            <Pill tone="warning" size="sm" active>
              4 and 5 now
            </Pill>
            <Pill tone="neutral" size="sm">
              19 after modules
            </Pill>
            <Pill tone="neutral" size="sm">
              24 then 25 then 29
            </Pill>
          </Row>
        </Stack>
        <Stack gap={8}>
          <H3>Parked</H3>
          <Text tone="secondary">
            Named asset catalogs, venture pricing, cash economies, homeworld
            moves, mergers, mass combat, and heat. The design already has a flag
            or a pack slot for each. They are data, added when a campaign needs
            the noun.
          </Text>
        </Stack>
      </Grid>

      <Text size="small" tone="tertiary">
        Written to docs/ROADMAP.md. Scores are planning judgments, not measurements.
        Source for items 4, 5, 19, 24, and 25: TODO.md and the 24 Sep 2026 playtest.
      </Text>
    </Stack>
  );
}
