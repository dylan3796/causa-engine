/**
 * Observatory mode — settlement's on-ramp for organizations with many agents
 * and no outcome contracts yet. Given raw activity runs and outcome events
 * (no contracts, no designs), it:
 *
 *   1. TRIANGULATES: discovers which run payload fields join to which outcome
 *      entities, with honest coverage numbers per candidate key;
 *   2. QUANTIFIES: per agent — runs, spend, and the outcome events its work
 *      touches, priced per outcome ("what you're paying for");
 *   3. PROPOSES: draft contracts per (agent × outcome type), the confirmation
 *      path onto the settled ledger.
 *
 * Everything here is OBSERVED association, stated as such: outcomes on
 * entities the agent's runs touched, within a window. Attribution — "would it
 * have happened anyway" — requires a counterfactual design; the observatory's
 * whole job is to make defining one a five-minute confirmation instead of a
 * workshop. Evidence-grade ceiling without one: D.
 */
import { DAY_MS } from "../time";
import { R2_unitCents, R4_pct } from "../numeric";
import type { ActivityRun, DraftContract, EngineInputs, OutcomeEvent } from "../types";

export interface JoinKeyFinding {
  /** The run payload field whose values match this entity kind's ids. */
  field: string;
  entityKind: string;
  runsWithField: number;
  runsMatchingEntities: number;
  /** Share of runs carrying this field whose value is a real entity id. */
  matchPct: number;
  distinctEntities: number;
  samples: string[];
}

export interface ObservedOutput {
  source: string;
  eventType: string;
  entityKind: string;
  /** Distinct (entity, eventType) outcomes on entities this agent's runs touched, within the window. */
  count: number;
  /** Agent spend ÷ count. Honest label: cost per TOUCHED outcome, not per attributed outcome. */
  costPerOutcomeCents: number;
  firstSeen: string;
  lastSeen: string;
}

export interface AgentObservation {
  actorId: string;
  models: string[];
  runs: number;
  runsJoined: number;
  joinPct: number;
  spendCents: number;
  outputs: ObservedOutput[];
  /** Runs whose payload matched no known entity — invisible work, honestly counted. */
  unjoinedRuns: number;
}

export interface ObservatoryReport {
  windowDays: number;
  joinKeys: JoinKeyFinding[];
  agents: AgentObservation[];
  drafts: Array<{ actorId: string; draft: DraftContract; volume: number }>;
  notes: string[];
}

interface Touch {
  entityKey: string;
  runStartMs: number;
}

export function observe(inputs: EngineInputs, windowDays = 30): ObservatoryReport {
  const notes: string[] = [
    "Observed association, not attribution: counts are outcome events on entities each agent's runs touched within the window.",
    "Cost per outcome divides the agent's full spend by that outcome count — it is the price of observed output, not a causal claim.",
    "Confirming a draft contract (and a baseline design) graduates an agent onto the settled ledger; until then the evidence-grade ceiling is D.",
  ];

  // --- index outcome entities by kind ---------------------------------------
  const idsByKind = new Map<string, Set<string>>();
  const eventsByEntityKey = new Map<string, OutcomeEvent[]>();
  for (const ev of inputs.outcomes) {
    let set = idsByKind.get(ev.entity.kind);
    if (!set) idsByKind.set(ev.entity.kind, (set = new Set()));
    set.add(ev.entity.id);
    const key = `${ev.entity.kind}:${ev.entity.id}`;
    let list = eventsByEntityKey.get(key);
    if (!list) eventsByEntityKey.set(key, (list = []));
    list.push(ev);
  }

  // --- triangulate: which run payload fields hold entity ids? ---------------
  const fieldStats = new Map<string, { withField: number; matches: Map<string, { count: number; entities: Set<string>; samples: string[] }> }>();
  for (const run of inputs.runs) {
    for (const [field, value] of Object.entries(run.payload.fields ?? {})) {
      let stat = fieldStats.get(field);
      if (!stat) fieldStats.set(field, (stat = { withField: 0, matches: new Map() }));
      stat.withField += 1;
      for (const [kind, ids] of idsByKind) {
        if (!ids.has(value)) continue;
        let m = stat.matches.get(kind);
        if (!m) stat.matches.set(kind, (m = { count: 0, entities: new Set(), samples: [] }));
        m.count += 1;
        m.entities.add(value);
        if (m.samples.length < 5) m.samples.push(`${field}=${value} → ${kind}:${value}`);
      }
    }
  }
  const joinKeys: JoinKeyFinding[] = [];
  for (const [field, stat] of fieldStats) {
    for (const [kind, m] of stat.matches) {
      const matchPct = R4_pct(m.count, stat.withField);
      if (m.count >= 3 && matchPct >= 20) {
        joinKeys.push({
          field,
          entityKind: kind,
          runsWithField: stat.withField,
          runsMatchingEntities: m.count,
          matchPct,
          distinctEntities: m.entities.size,
          samples: m.samples,
        });
      }
    }
  }
  joinKeys.sort((a, b) => b.runsMatchingEntities - a.runsMatchingEntities || (a.field < b.field ? -1 : 1));
  if (joinKeys.length === 0) {
    notes.push("No join keys found: no run payload field matched outcome entity ids. Check exports share an identifier.");
  }

  const keysByField = new Map<string, string[]>();
  for (const jk of joinKeys) {
    const kinds = keysByField.get(jk.field) ?? [];
    kinds.push(jk.entityKind);
    keysByField.set(jk.field, kinds);
  }

  // --- per agent: touches, outputs, economics --------------------------------
  const windowMs = windowDays * DAY_MS;
  const actorIds = [...new Set(inputs.runs.map((r) => r.actorId))].sort();
  const agents: AgentObservation[] = [];
  const drafts: ObservatoryReport["drafts"] = [];

  for (const actorId of actorIds) {
    const runs = inputs.runs.filter((r) => r.actorId === actorId);
    const spendCents = runs.reduce((a, r) => a + r.costCents, 0);
    const models = [...new Set(runs.map((r) => r.model).filter((m): m is string => !!m))].sort();

    const touches: Touch[] = [];
    let runsJoined = 0;
    for (const run of runs) {
      let joined = false;
      for (const [field, value] of Object.entries(run.payload.fields ?? {})) {
        for (const kind of keysByField.get(field) ?? []) {
          if (!idsByKind.get(kind)!.has(value)) continue;
          touches.push({ entityKey: `${kind}:${value}`, runStartMs: Date.parse(run.startedAt) });
          joined = true;
        }
      }
      if (joined) runsJoined += 1;
    }

    // Distinct outcomes touched: (entity, event) pairs where some touch
    // precedes the event within the window.
    const seen = new Set<string>();
    const byType = new Map<string, { count: number; source: string; entityKind: string; first: string; last: string }>();
    for (const t of touches) {
      for (const ev of eventsByEntityKey.get(t.entityKey) ?? []) {
        const evMs = Date.parse(ev.occurredAt);
        if (evMs <= t.runStartMs || evMs - t.runStartMs >= windowMs) continue;
        const dedup = `${ev.id}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        const typeKey = `${ev.source}:${ev.eventType}`;
        let agg = byType.get(typeKey);
        if (!agg) byType.set(typeKey, (agg = { count: 0, source: ev.source, entityKind: ev.entity.kind, first: ev.occurredAt, last: ev.occurredAt }));
        agg.count += 1;
        if (ev.occurredAt < agg.first) agg.first = ev.occurredAt;
        if (ev.occurredAt > agg.last) agg.last = ev.occurredAt;
      }
    }

    const outputs: ObservedOutput[] = [...byType.entries()]
      .map(([typeKey, agg]) => ({
        source: agg.source,
        eventType: typeKey.split(":").slice(1).join(":"),
        entityKind: agg.entityKind,
        count: agg.count,
        costPerOutcomeCents: R2_unitCents(spendCents, agg.count),
        firstSeen: agg.first,
        lastSeen: agg.last,
      }))
      .sort((a, b) => b.count - a.count || (a.eventType < b.eventType ? -1 : 1));

    for (const out of outputs) {
      drafts.push({
        actorId,
        volume: out.count,
        draft: { source: out.source, eventType: out.eventType, entityKind: out.entityKind, suggestedQualityBar: null },
      });
    }

    agents.push({
      actorId,
      models,
      runs: runs.length,
      runsJoined,
      joinPct: runs.length === 0 ? 0 : R4_pct(runsJoined, runs.length),
      spendCents,
      outputs,
      unjoinedRuns: runs.length - runsJoined,
    });
  }

  agents.sort((a, b) => b.spendCents - a.spendCents || (a.actorId < b.actorId ? -1 : 1));
  return { windowDays, joinKeys, agents, drafts, notes };
}
