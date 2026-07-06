/**
 * The outcome engine's interpretation stage. Verification (verify/verify.ts)
 * identifies outcomes the customer already defined; this module interprets
 * what else the systems of record are showing and PROPOSES outcome
 * definitions — draft contracts with provenance and checkable samples —
 * because not every outcome arrives clearly defined up front. Interpretation
 * proposes; only a confirmed contract ever settles money.
 *
 * Four interpretation rules (deterministic, v1):
 *  - uncontractedOutcome     joined events no contract covers → draft a contract
 *  - qualityBarBoundary      outcomes failing just past the bar → draft a wider bar
 *  - unpricedQualityFailures failures no billing line prices → count them, per reason
 *  - duplicateClaims         double-billed outcomes → billing-integrity finding
 */
import { DAY_MS } from "../time";
import type { ContributionGraph } from "../join/graph";
import type {
  CandidateOutcome,
  DisputeBlock,
  OutcomeEvent,
  QualityPredicate,
  VerificationReport,
} from "../types";

export interface IdentifiedWorkflow {
  graph: ContributionGraph;
  report: VerificationReport;
  dispute?: DisputeBlock;
}

function findNoEventWithinBar(
  bar: QualityPredicate | null
): { eventType: string; days: number } | undefined {
  if (!bar) return undefined;
  if (bar.kind === "noEventWithin") return { eventType: bar.eventType, days: bar.days };
  if (bar.kind === "all") {
    for (const sub of bar.of) {
      const found = findNoEventWithinBar(sub);
      if (found) return found;
    }
  }
  return undefined;
}

function boundaryCandidate(item: IdentifiedWorkflow, widenedDays: number): CandidateOutcome | undefined {
  const { graph, report } = item;
  const bar = findNoEventWithinBar(graph.contract.qualityBar);
  if (!bar || report.verified.length === 0) return undefined;

  const entities: string[] = [];
  let firstSeen: string | undefined;
  let lastSeen: string | undefined;
  for (const v of report.verified) {
    const anchorMs = Date.parse(v.occurredAt);
    const from = anchorMs + bar.days * DAY_MS;
    const to = anchorMs + widenedDays * DAY_MS;
    const hit = (graph.eventsByEntity.get(v.entityKey) ?? []).find((ev) => {
      if (ev.eventType !== bar.eventType) return false;
      const t = Date.parse(ev.occurredAt);
      return t >= from && t < to;
    });
    if (!hit) continue;
    entities.push(v.entityKey);
    if (!firstSeen || hit.occurredAt < firstSeen) firstSeen = hit.occurredAt;
    if (!lastSeen || hit.occurredAt > lastSeen) lastSeen = hit.occurredAt;
  }
  if (entities.length === 0) return undefined;

  const pct = Math.round((100 * entities.length) / report.verified.length);
  return {
    kind: "qualityBarBoundary",
    source: graph.contract.event.source,
    eventType: bar.eventType,
    count: entities.length,
    workflowId: graph.contract.workflowId,
    pctOfVerified: pct,
    draft: {
      source: graph.contract.event.source,
      eventType: graph.contract.event.eventType,
      entityKind: graph.contract.join.entityKind,
      suggestedQualityBar: { kind: "noEventWithin", eventType: bar.eventType, days: widenedDays },
    },
    context: [
      `${entities.length} verified outcomes (${pct}%) had a ${bar.eventType} land after day ${bar.days} but inside day ${widenedDays} — just past the quality bar.`,
      `Widening the bar to ${widenedDays} days would count them as failures.`,
    ],
    sampleEntities: entities.slice(0, 5),
    firstSeen,
    lastSeen,
  };
}

function unpricedFailureCandidates(item: IdentifiedWorkflow): CandidateOutcome[] {
  const { graph, report, dispute } = item;
  // A dispute block prices every quality failure back against the invoice;
  // without one, the failures cost nobody anything — that is the finding.
  if (dispute) return [];
  return Object.entries(report.qualityFailures)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([reason, count]) => ({
      kind: "unpricedQualityFailures" as const,
      source: graph.contract.event.source,
      eventType: reason,
      count,
      workflowId: graph.contract.workflowId,
      context: [
        `${count} claims failed the quality bar (${reason}) and no billing line prices the failure.`,
        "Counting these as a contracted outcome (or pricing the failure) would make the loss visible.",
      ],
      sampleEntities: (report.qualityFailureSamples?.[reason] ?? []).slice(0, 5),
    }));
}

function duplicateCandidate(item: IdentifiedWorkflow): CandidateOutcome | undefined {
  const { graph, report } = item;
  if (report.drop.duplicateClaim === 0) return undefined;
  return {
    kind: "duplicateClaims",
    source: graph.contract.event.source,
    eventType: graph.contract.event.eventType,
    count: report.drop.duplicateClaim,
    workflowId: graph.contract.workflowId,
    context: [
      `${report.drop.duplicateClaim} claims assert outcomes already settled by an earlier claim — double-billed work.`,
    ],
    sampleEntities: (report.duplicateSamples ?? []).slice(0, 5),
  };
}

function uncontractedCandidates(items: IdentifiedWorkflow[]): CandidateOutcome[] {
  // Every event type any contract already accounts for, anywhere.
  const declaredEverywhere = new Set(items.flatMap((i) => i.graph.contract.declaredEventTypes));
  const seenEventIds = new Set<string>();

  interface Cluster {
    events: OutcomeEvent[];
    entities: Set<string>;
    workflowId: string;
    entityKind: string;
  }
  const clusters = new Map<string, Cluster>();

  for (const { graph } of items) {
    for (const [entKey, touches] of graph.touchesByEntity) {
      if (touches.length === 0) continue;
      for (const ev of graph.eventsByEntity.get(entKey) ?? []) {
        if (declaredEverywhere.has(ev.eventType)) continue;
        if (seenEventIds.has(ev.id)) continue;
        seenEventIds.add(ev.id);
        const key = `${ev.source}:${ev.eventType}`;
        let cluster = clusters.get(key);
        if (!cluster) {
          clusters.set(
            key,
            (cluster = {
              events: [],
              entities: new Set(),
              workflowId: graph.contract.workflowId,
              entityKind: graph.contract.join.entityKind,
            })
          );
        }
        cluster.events.push(ev);
        cluster.entities.add(entKey);
      }
    }
  }

  return [...clusters.values()]
    .sort((a, b) => b.events.length - a.events.length || (a.events[0].id < b.events[0].id ? -1 : 1))
    .map((cluster) => {
      const first = cluster.events.reduce((min, e) => (e.occurredAt < min ? e.occurredAt : min), cluster.events[0].occurredAt);
      const last = cluster.events.reduce((max, e) => (e.occurredAt > max ? e.occurredAt : max), cluster.events[0].occurredAt);
      const ev = cluster.events[0];
      return {
        kind: "uncontractedOutcome" as const,
        source: ev.source,
        eventType: ev.eventType,
        count: cluster.events.length,
        workflowId: cluster.workflowId,
        draft: {
          source: ev.source,
          eventType: ev.eventType,
          entityKind: cluster.entityKind,
          suggestedQualityBar: null,
        },
        context: [
          `${cluster.events.length} ${ev.eventType} events in ${ev.source} occur on ${cluster.entityKind} entities the ${cluster.workflowId} agent's runs touch. No outcome contract covers them.`,
          "Confirming the draft contract would bring these outcomes onto the ledger.",
        ],
        sampleEntities: [...cluster.entities].sort().slice(0, 5),
        firstSeen: first,
        lastSeen: last,
      };
    });
}

/**
 * All candidate outcomes across the statement, deterministically ordered:
 * per-workflow interpretations in contract order, then uncontracted clusters
 * by descending volume.
 */
export function interpretCandidates(items: IdentifiedWorkflow[], widenedDays: number): CandidateOutcome[] {
  const candidates: CandidateOutcome[] = [];
  for (const item of items) {
    const boundary = boundaryCandidate(item, widenedDays);
    if (boundary) candidates.push(boundary);
    candidates.push(...unpricedFailureCandidates(item));
    const duplicate = duplicateCandidate(item);
    if (duplicate) candidates.push(duplicate);
  }
  candidates.push(...uncontractedCandidates(items));
  return candidates;
}
