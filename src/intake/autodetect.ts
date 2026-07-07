/**
 * Auto-detection for the playground path: infer file format, guess column
 * mappings from common naming, and classify a file as agent activity vs
 * outcome records. Guesses are DECLARED (every inference produces a note) —
 * auto-mapping proposes, the intake report shows what was assumed, and a real
 * engagement graduates to an explicit config.
 */
import type { TableReadResult } from "./csv";
import { parseCsv, parseNdjson } from "./csv";
import type { ActivitySourceSpec, EngagementConfig, OutcomeSourceSpec } from "./build";

export function detectFormat(content: string): "csv" | "ndjson" {
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (t === "") continue;
    return t.startsWith("{") ? "ndjson" : "csv";
  }
  return "csv";
}

const SYN = {
  runId: ["run_id", "trace_id", "span_id", "run", "id", "event_id"],
  actor: ["actor", "actor_id", "agent", "agent_id", "agent_name", "bot", "assistant", "app"],
  model: ["model", "llm", "model_name", "engine"],
  time: ["started_at", "start_time", "timestamp", "ts", "time", "created_at", "updated_at", "date", "occurred_at", "event_time"],
  cost: ["cost_usd", "cost", "usd", "amount", "total_cost", "price", "spend"],
  text: ["text", "output", "message", "summary", "notes", "content"],
  entityId: [
    "entity_id", "ticket_id", "invoice_id", "case_id", "issue_id", "opportunity_id", "prospect_id",
    "record_id", "object_id", "document_id", "order_id", "external_id",
  ],
  entityKind: ["entity_kind", "kind", "object", "object_type", "record_type", "entity"],
  eventType: ["event_type", "event", "type", "status", "action", "activity"],
  source: ["source", "system", "platform", "origin"],
} as const;

function pick(columns: string[], candidates: readonly string[]): string | undefined {
  const lower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  for (const cand of candidates) {
    const hit = lower.get(cand);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function slug(s: string): string {
  const t = s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(t) ? t : `x_${t || "file"}`;
}

export interface DetectedFile {
  file: string;
  format: "csv" | "ndjson";
  kind: "activity" | "outcome";
  spec: ActivitySourceSpec | OutcomeSourceSpec;
  notes: string[];
}

/**
 * Classify + map one uploaded file. `kindHint` forces the classification;
 * otherwise: a file with an actor-ish column and a time column reads as
 * activity, anything else with an event-ish column reads as outcomes.
 */
export function detectFile(name: string, content: string, kindHint?: "activity" | "outcome"): DetectedFile {
  const format = detectFormat(content);
  const table: TableReadResult = format === "csv" ? parseCsv(content) : parseNdjson(content);
  const columns = table.columns;
  const notes: string[] = [`format detected: ${format}`];

  const actorCol = pick(columns, SYN.actor);
  const eventCol = pick(columns, SYN.eventType);
  const kind = kindHint ?? (actorCol ? "activity" : "outcome");
  if (!kindHint) notes.push(`classified as ${kind} (${actorCol ? `actor column "${actorCol}"` : "no actor column"})`);

  const timeCol = pick(columns, SYN.time);
  if (!timeCol) notes.push(`no timestamp column recognized among [${columns.join(", ")}] — rows will reject`);
  const sourceCol = pick(columns, SYN.source);
  const defaultSource = slug(name.replace(/\.(csv|ndjson|json|txt)$/i, ""));

  if (kind === "activity") {
    const idCol = pick(columns, SYN.runId);
    const costCol = pick(columns, SYN.cost);
    const modelCol = pick(columns, SYN.model);
    const textCol = pick(columns, SYN.text);
    const mapped = new Set([idCol, actorCol, costCol, modelCol, timeCol, textCol, sourceCol].filter(Boolean) as string[]);
    // Every unmapped column rides along as a payload field — that is where
    // join keys hide, and join detection scans exactly these.
    const fields = columns.filter((c) => !mapped.has(c));
    notes.push(
      `mapped: id←${idCol ?? "(row number)"} actor←${actorCol ?? "(constant)"} time←${timeCol ?? "—"}` +
        `${costCol ? ` cost←${costCol}` : ""}${modelCol ? ` model←${modelCol}` : ""}; ${fields.length} column(s) kept as join-key fields [${fields.join(", ")}]`
    );
    const spec: ActivitySourceSpec = {
      file: name,
      format,
      source: sourceCol ?? { const: "log_upload" },
      map: {
        id: idCol, // absent → stable row-number ids
        actorId: actorCol ?? { const: slug(name) || "agent" },
        model: modelCol,
        startedAt: timeCol ?? "started_at",
        costUsd: costCol,
        fields,
        text: textCol,
      },
    };
    return { file: name, format, kind, spec, notes };
  }

  // Entity id: known synonyms first, then any *_id / *_ref column that isn't
  // a run identifier, then a bare "id".
  const NOT_ENTITY = new Set(["run_id", "trace_id", "span_id", "event_id"]);
  const entityIdCol =
    pick(columns, SYN.entityId) ??
    columns.find((c) => /_(id|ref)$/i.test(c) && !NOT_ENTITY.has(c.toLowerCase())) ??
    pick(columns, ["id"]);
  const entityKindCol = pick(columns, SYN.entityKind);
  const entityKindConst = entityIdCol && /_(id|ref)$/i.test(entityIdCol)
    ? entityIdCol.toLowerCase().replace(/_(id|ref)$/, "")
    : defaultSource;
  notes.push(
    `mapped: entity←${entityIdCol ?? "—"} (kind ${entityKindCol ? `←${entityKindCol}` : `"${entityKindConst}"`}) event←${eventCol ?? "—"} time←${timeCol ?? "—"} source←${sourceCol ?? `"${defaultSource}"`}`
  );
  const spec: OutcomeSourceSpec = {
    file: name,
    format,
    source: sourceCol ?? { const: defaultSource },
    map: {
      entityKind: entityKindCol ?? { const: entityKindConst },
      entityId: entityIdCol ?? "entity_id",
      eventType: eventCol ?? "event_type",
      occurredAt: timeCol ?? "occurred_at",
    },
  };
  return { file: name, format, kind, spec, notes };
}

/**
 * Assemble a contract-free engagement from raw uploads — the observatory
 * path. No contracts, no claims, a wide-open period: just canonical records
 * ready for triangulation. Detections carry every assumption made.
 */
export function autoEngagement(
  files: Array<{ name: string; content: string; kind?: "activity" | "outcome" }>
): { engagement: EngagementConfig; detections: DetectedFile[] } {
  const detections = files.map((f) => detectFile(f.name, f.content, f.kind));
  const engagement: EngagementConfig = {
    name: "Playground (auto-detected)",
    period: { start: "2000-01-01T00:00:00.000Z", end: "2100-01-01T00:00:00.000Z" },
    actors: [],
    activitySources: detections.filter((d) => d.kind === "activity").map((d) => d.spec as ActivitySourceSpec),
    outcomeSources: detections.filter((d) => d.kind === "outcome").map((d) => d.spec as OutcomeSourceSpec),
    contracts: [],
    extractRuleSets: [],
    verdictRules: [],
    activitySourceLabels: {},
  };
  return { engagement, detections };
}
