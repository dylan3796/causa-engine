/**
 * Dogfood exporter: write the Meridian fixture as customer-shaped exports —
 * runs.ndjson (payload verbatim) + outcomes.csv — plus the engagement.json
 * that maps them. `npm run example` then settles the engagement through the
 * REAL intake path and must reproduce the published ledger exactly.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateMeridianInputs, ACTORS } from "../src/fixtures/meridian/generate";
import { CONTRACTS, EXTRACT_RULE_SETS, MERIDIAN_CONFIG, VERDICT_RULES } from "../src/fixtures/meridian/config";
import { CELLS } from "../src/fixtures/meridian/workbook";
import type { EngagementConfig } from "../src/intake/engagement";

const here = dirname(fileURLToPath(import.meta.url));
const exampleDir = join(here, "..", "examples", "meridian");
const dataDir = join(exampleDir, "data");
mkdirSync(dataDir, { recursive: true });

const inputs = generateMeridianInputs();

const csvEscape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// Activity: NDJSON, payload carried verbatim, claim fields flattened.
const runLines = inputs.runs.map((r) =>
  JSON.stringify({
    id: r.id,
    source: r.source,
    actor: r.actorId,
    model: r.model ?? "",
    started_at: r.startedAt,
    ended_at: r.endedAt,
    cost_usd: (r.costCents / 100).toFixed(2),
    payload: r.payload,
    claim_workflow: r.claim?.workflowId ?? "",
    claim_event: r.claim?.claimedEventType ?? "",
    claim_at: r.claim?.claimedAt ?? "",
  })
);
writeFileSync(join(dataDir, "runs.ndjson"), runLines.join("\n") + "\n");

// Outcomes: flat CSV.
const outcomeHeader = "id,source,entity_kind,entity_id,event_type,occurred_at,experiment_id,arm";
const outcomeLines = inputs.outcomes.map((ev) =>
  [
    ev.id,
    ev.source,
    ev.entity.kind,
    ev.entity.id,
    ev.eventType,
    ev.occurredAt,
    ev.assignment?.experimentId ?? "",
    ev.assignment?.arm ?? "",
  ]
    .map(csvEscape)
    .join(",")
);
writeFileSync(join(dataDir, "outcomes.csv"), outcomeHeader + "\n" + outcomeLines.join("\n") + "\n");

const engagement: EngagementConfig = {
  name: "Meridian (fictional) · June 2026",
  period: { start: CELLS.periodStart, end: CELLS.periodEnd },
  actors: [...ACTORS],
  activitySources: [
    {
      file: "data/runs.ndjson",
      format: "ndjson",
      source: "source",
      map: {
        id: "id",
        actorId: "actor",
        model: "model",
        startedAt: "started_at",
        endedAt: "ended_at",
        costUsd: "cost_usd",
        payloadKey: "payload",
        claim: { workflowId: "claim_workflow", claimedEventType: "claim_event", claimedAt: "claim_at" },
      },
    },
  ],
  outcomeSources: [
    {
      file: "data/outcomes.csv",
      format: "csv",
      source: "source",
      map: {
        id: "id",
        entityKind: "entity_kind",
        entityId: "entity_id",
        eventType: "event_type",
        occurredAt: "occurred_at",
        assignment: { experimentId: "experiment_id", arm: "arm" },
      },
    },
  ],
  contracts: CONTRACTS,
  extractRuleSets: EXTRACT_RULE_SETS,
  verdictRules: VERDICT_RULES,
  activitySourceLabels: MERIDIAN_CONFIG.activitySourceLabels,
  boundaryWindowDays: MERIDIAN_CONFIG.boundaryWindowDays,
};
writeFileSync(join(exampleDir, "engagement.json"), JSON.stringify(engagement, null, 2) + "\n");

console.log(`wrote ${dataDir}/runs.ndjson (${inputs.runs.length} runs)`);
console.log(`wrote ${dataDir}/outcomes.csv (${inputs.outcomes.length} events)`);
console.log(`wrote ${exampleDir}/engagement.json`);
