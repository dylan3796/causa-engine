/**
 * Tier-0 engagement intake, pure core — "two exports and a join key"
 * (CAUSA.md §6.5). No filesystem, no environment: file contents come in
 * through a reader function, so the same code runs in the CLI and in the
 * browser playground.
 *
 * An engagement is a serializable config: where the customer's exports live,
 * how their columns map onto canonical records, the outcome contracts, and
 * the verdict rules. buildEngagement() turns it into EngineInputs + an
 * EngineConfig plus an intake report that accounts for every row — read,
 * mapped, or rejected with a reason.
 */
import type { EngineConfig } from "../statement";
import type { ExtractRuleSet } from "../extract/extractors";
import type { VerdictRule } from "../verdict/engine";
import type { Actor, ActivityRun, EngineInputs, OutcomeContract, OutcomeEvent, SourceId } from "../types";
import { EngineError } from "../types";
import { parseCsv, parseNdjson, type RowReject, type TableReadResult } from "./csv";
import { mapRows, resolveField, resolveOptional, normalizeTimestamp, RowError, usdToCents, type FieldSpec } from "./mapping";

const SOURCE_TOKEN = /^[a-z][a-z0-9_-]*$/;

export interface ActivitySourceSpec {
  file: string;
  format: "csv" | "ndjson";
  /** Fixed source id, or a per-row column (one export may carry several systems). */
  source: FieldSpec;
  map: {
    /** Omit to auto-assign stable row-number ids ("file#N"). */
    id?: FieldSpec;
    actorId: FieldSpec;
    model?: FieldSpec;
    startedAt: FieldSpec;
    endedAt?: FieldSpec;
    /** Dollars in the export; stored as integer cents. Default 0. */
    costUsd?: FieldSpec;
    /** Columns copied verbatim into payload.fields — where join keys usually live. */
    fields?: string[];
    /** Free-text column; regex extraction rules read this. */
    text?: FieldSpec;
    /** NDJSON only: a key whose value is the full canonical payload object. */
    payloadKey?: string;
    /** A row claims an outcome when workflowId resolves non-empty; otherwise it's a non-claiming step. */
    claim?: {
      workflowId: FieldSpec;
      claimedEventType: FieldSpec;
      claimedAt?: FieldSpec;
    };
  };
}

export interface OutcomeSourceSpec {
  file: string;
  format: "csv" | "ndjson";
  /** Fixed source id, or a per-row column. */
  source: FieldSpec;
  map: {
    id?: FieldSpec;
    entityKind: FieldSpec;
    entityId: FieldSpec;
    eventType: FieldSpec;
    occurredAt: FieldSpec;
    assignment?: { experimentId: FieldSpec; arm: FieldSpec };
  };
}

export interface EngagementConfig {
  name: string;
  period: { start: string; end: string };
  actors: Actor[];
  activitySources: ActivitySourceSpec[];
  outcomeSources: OutcomeSourceSpec[];
  contracts: OutcomeContract[];
  extractRuleSets: ExtractRuleSet[];
  verdictRules: VerdictRule[];
  activitySourceLabels: Partial<Record<SourceId, string>>;
  boundaryWindowDays?: number;
}

export interface FileIntake {
  file: string;
  kind: "activity" | "outcome";
  rowsRead: number;
  recordsProduced: number;
  rejects: RowReject[];
  outsidePeriod: number;
}

export interface IntakeReport {
  engagement: string;
  files: FileIntake[];
  assumptions: string[];
  totals: { rowsRead: number; recordsProduced: number; rejected: number };
}

export interface LoadedEngagement {
  inputs: EngineInputs;
  config: EngineConfig;
  report: IntakeReport;
}

/** Read a named file's contents. The CLI backs this with fs; the browser with uploads. */
export type FileReader = (file: string) => string;

export function parseTable(content: string, format: "csv" | "ndjson"): TableReadResult {
  return format === "csv" ? parseCsv(content) : parseNdjson(content);
}

function resolveSource(row: Parameters<typeof resolveField>[0], spec: FieldSpec): SourceId {
  const value = resolveField(row, spec, "source");
  if (!SOURCE_TOKEN.test(value)) {
    throw new RowError(`malformed source "${value}" (expected a lowercase token like "zendesk")`);
  }
  return value;
}

function isValidPayload(value: unknown): value is ActivityRun["payload"] {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function buildEngagement(engagement: EngagementConfig, readFile: FileReader): LoadedEngagement {
  const periodStartMs = Date.parse(engagement.period.start);
  const periodEndMs = Date.parse(engagement.period.end);
  if (Number.isNaN(periodStartMs) || Number.isNaN(periodEndMs) || periodEndMs <= periodStartMs) {
    throw new EngineError("intake", `invalid engagement period ${engagement.period.start} → ${engagement.period.end}`);
  }

  const files: FileIntake[] = [];
  const assumptions: string[] = ["Naive timestamps (no timezone) in exports are read as UTC."];

  const runs: ActivityRun[] = [];
  const seenRunIds = new Set<string>();
  for (const spec of engagement.activitySources) {
    const table = parseTable(readFile(spec.file), spec.format);
    let outsidePeriod = 0;

    const { records, rejects } = mapRows(table.rows, (row): ActivityRun => {
      const id = spec.map.id ? resolveField(row, spec.map.id, "run id") : `${spec.file}#${row.rowNum}`;
      if (seenRunIds.has(id)) throw new RowError(`duplicate run id "${id}"`);

      const startedAt = resolveField(row, { column: columnOf(spec.map.startedAt), transform: "timestamp" }, "startedAt");
      const endedAtRaw = resolveOptional(row, spec.map.endedAt, "endedAt");
      const endedAt = endedAtRaw ? normalizeTimestamp(endedAtRaw) : startedAt;

      const costRaw = resolveOptional(row, spec.map.costUsd, "cost");
      const costCents = costRaw === undefined ? 0 : usdToCents(costRaw);

      let payload: ActivityRun["payload"] = {};
      if (spec.map.payloadKey) {
        const p = row.values[spec.map.payloadKey];
        if (!isValidPayload(p)) throw new RowError(`payload key "${spec.map.payloadKey}" is not an object`);
        payload = p;
      } else {
        const fields: Record<string, string> = {};
        for (const col of spec.map.fields ?? []) {
          const v = row.values[col];
          if (v !== undefined && v !== null && v !== "") fields[col] = String(v);
        }
        const text = resolveOptional(row, spec.map.text, "text");
        payload = {
          ...(Object.keys(fields).length > 0 ? { fields } : {}),
          ...(text !== undefined ? { text } : {}),
        };
      }

      let claim: ActivityRun["claim"];
      const c = spec.map.claim;
      if (c) {
        const workflowId = resolveOptional(row, c.workflowId, "claim workflowId");
        if (workflowId !== undefined) {
          claim = {
            workflowId,
            claimedEventType: resolveField(row, c.claimedEventType, "claim event type"),
            claimedAt: c.claimedAt
              ? resolveField(row, { column: columnOf(c.claimedAt), transform: "timestamp" }, "claimedAt")
              : startedAt,
          };
        }
      }

      const startedMs = Date.parse(startedAt);
      if (startedMs < periodStartMs || startedMs >= periodEndMs) outsidePeriod += 1;

      seenRunIds.add(id);
      return {
        id,
        source: resolveSource(row, spec.source),
        actorId: resolveField(row, spec.map.actorId, "actorId"),
        model: resolveOptional(row, spec.map.model, "model"),
        startedAt,
        endedAt,
        costCents,
        payload,
        claim,
      };
    });

    runs.push(...records);
    files.push({
      file: spec.file,
      kind: "activity",
      rowsRead: table.rows.length + table.rejects.length,
      recordsProduced: records.length,
      rejects: [...table.rejects, ...rejects],
      outsidePeriod,
    });
  }

  const outcomes: OutcomeEvent[] = [];
  let autoId = 0;
  for (const spec of engagement.outcomeSources) {
    const table = parseTable(readFile(spec.file), spec.format);
    let outsidePeriod = 0;

    const { records, rejects } = mapRows(table.rows, (row): OutcomeEvent => {
      const occurredAt = resolveField(row, { column: columnOf(spec.map.occurredAt), transform: "timestamp" }, "occurredAt");
      let assignment: OutcomeEvent["assignment"];
      const a = spec.map.assignment;
      if (a) {
        const arm = resolveOptional(row, a.arm, "assignment arm");
        if (arm !== undefined) {
          assignment = { experimentId: resolveField(row, a.experimentId, "experimentId"), arm };
        }
      }
      const occurredMs = Date.parse(occurredAt);
      // Outcome events legitimately trail the period (reopens, late logins);
      // only pre-period events count as outside.
      if (occurredMs < periodStartMs) outsidePeriod += 1;

      return {
        id: spec.map.id ? resolveField(row, spec.map.id, "event id") : `${spec.file}-${++autoId}`,
        source: resolveSource(row, spec.source),
        entity: { kind: resolveField(row, spec.map.entityKind, "entityKind"), id: resolveField(row, spec.map.entityId, "entityId") },
        eventType: resolveField(row, spec.map.eventType, "eventType"),
        occurredAt,
        assignment,
      };
    });

    outcomes.push(...records);
    files.push({
      file: spec.file,
      kind: "outcome",
      rowsRead: table.rows.length + table.rejects.length,
      recordsProduced: records.length,
      rejects: [...table.rejects, ...rejects],
      outsidePeriod,
    });
  }

  const totals = {
    rowsRead: files.reduce((a, f) => a + f.rowsRead, 0),
    recordsProduced: files.reduce((a, f) => a + f.recordsProduced, 0),
    rejected: files.reduce((a, f) => a + f.rejects.length, 0),
  };
  if (totals.rowsRead !== totals.recordsProduced + totals.rejected) {
    throw new EngineError("intake", `row conservation violated: ${totals.rowsRead} read vs ${totals.recordsProduced} + ${totals.rejected}`);
  }

  return {
    inputs: {
      periodStart: engagement.period.start,
      periodEnd: engagement.period.end,
      actors: engagement.actors,
      runs,
      outcomes,
    },
    config: {
      contracts: engagement.contracts,
      extractRuleSets: engagement.extractRuleSets,
      verdictRules: engagement.verdictRules,
      activitySourceLabels: engagement.activitySourceLabels,
      boundaryWindowDays: engagement.boundaryWindowDays ?? 30,
    },
    report: { engagement: engagement.name, files, assumptions, totals },
  };
}

function columnOf(spec: FieldSpec): string {
  if (typeof spec === "string") return spec;
  if ("column" in spec) return spec.column;
  throw new EngineError("intake", "timestamp fields cannot be constants");
}

export function renderIntakeReport(report: IntakeReport): string {
  const lines: string[] = [];
  lines.push(`# Intake report — ${report.engagement}`);
  lines.push("");
  lines.push(
    `**${report.totals.rowsRead} rows read → ${report.totals.recordsProduced} records · ${report.totals.rejected} rejected** (every row accounted for)`
  );
  lines.push("");
  for (const f of report.files) {
    lines.push(`## ${f.file} (${f.kind})`);
    lines.push(`- ${f.rowsRead} rows → ${f.recordsProduced} records · ${f.rejects.length} rejected · ${f.outsidePeriod} outside the period`);
    const byReason = new Map<string, number>();
    for (const r of f.rejects) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    for (const [reason, count] of [...byReason.entries()].sort()) {
      const sample = f.rejects.find((r) => r.reason === reason)!;
      lines.push(`  - ${reason}: ${count} (e.g. row ${sample.rowNum}: ${sample.sample})`);
    }
    lines.push("");
  }
  lines.push(`## Assumptions`);
  for (const a of report.assumptions) lines.push(`- ${a}`);
  lines.push("");
  return lines.join("\n");
}
