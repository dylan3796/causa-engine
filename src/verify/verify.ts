/**
 * Verification: Claimed → Verified, with every dropped claim accounted for.
 * Conservation law (asserted downstream): claimed = verified + didNotHappen
 * + failedQualityBar + unjoinable + duplicateClaim. Nothing silently
 * disappears — and a double-billed outcome is named as such, not buried.
 *
 * Window semantics are half-open and pinned by unit test: a quality window of
 * N days is [t, t + N·24h) — a reopen at exactly t + 7 days is OUTSIDE a
 * 7-day bar and passes it.
 */
import { R4_pct } from "../numeric";
import { DAY_MS, HOUR_MS } from "../time";
import type { ContributionGraph } from "../join/graph";
import { qualifyingTouches, sliceOf } from "../join/contribution";
import type { OutcomeEvent, QualityPredicate, VerificationReport, VerifiedOutcome } from "../types";
import { EngineError } from "../types";

type QualityCheck = { pass: true } | { pass: false; reason: string };

/** Evaluate a quality bar over an entity's timeline, anchored at the outcome event. */
export function evaluateQuality(
  bar: QualityPredicate | null,
  timeline: OutcomeEvent[],
  anchorMs: number
): QualityCheck {
  if (bar === null) return { pass: true };
  switch (bar.kind) {
    case "noEventWithin": {
      const limit = anchorMs + bar.days * DAY_MS;
      const violating = timeline.some((ev) => {
        if (ev.eventType !== bar.eventType) return false;
        const t = Date.parse(ev.occurredAt);
        return t >= anchorMs && t < limit;
      });
      return violating ? { pass: false, reason: `${bar.eventType}_within_${bar.days}d` } : { pass: true };
    }
    case "eventWithin": {
      const limit = anchorMs + bar.hours * HOUR_MS;
      const found = timeline.some((ev) => {
        if (ev.eventType !== bar.eventType) return false;
        const t = Date.parse(ev.occurredAt);
        return t >= anchorMs && t < limit;
      });
      return found ? { pass: true } : { pass: false, reason: `no_${bar.eventType}_within_${bar.hours}h` };
    }
    case "requireEvent":
      return timeline.some((ev) => ev.eventType === bar.eventType)
        ? { pass: true }
        : { pass: false, reason: `missing_${bar.eventType}` };
    case "noEventOfType":
      return timeline.some((ev) => ev.eventType === bar.eventType)
        ? { pass: false, reason: bar.eventType }
        : { pass: true };
    case "all": {
      for (const sub of bar.of) {
        const r = evaluateQuality(sub, timeline, anchorMs);
        if (!r.pass) return r;
      }
      return { pass: true };
    }
  }
}

/**
 * Does an entity satisfy the contract (event occurred + quality bar), with no
 * claim as anchor? Used to score control/pre-period arms in the causal stage —
 * the same deterministic check the treated side went through.
 */
export function entitySatisfiesContract(graph: ContributionGraph, entKey: string): boolean {
  const timeline = graph.eventsByEntity.get(entKey) ?? [];
  const event = timeline.find((ev) => ev.eventType === graph.contract.event.eventType);
  if (!event) return false;
  return evaluateQuality(graph.contract.qualityBar, timeline, Date.parse(event.occurredAt)).pass;
}

export function verifyClaims(graph: ContributionGraph): VerificationReport {
  const contract = graph.contract;
  const claims = graph.workflowRuns
    .filter((r) => r.claim?.workflowId === contract.workflowId)
    .sort((a, b) => {
      const ca = a.claim!.claimedAt;
      const cb = b.claim!.claimedAt;
      return ca < cb ? -1 : ca > cb ? 1 : a.id < b.id ? -1 : 1;
    });

  const verified: VerifiedOutcome[] = [];
  const drop = { didNotHappen: 0, failedQualityBar: 0, unjoinable: 0, duplicateClaim: 0 };
  const qualityFailures: Record<string, number> = {};
  const qualityFailureSamples: Record<string, string[]> = {};
  const duplicateSamples: string[] = [];
  // Entities whose outcome a claim has already settled (verified OR failed
  // the quality bar). A later claim on a settled entity is a double-bill —
  // its own drop bucket, never folded into "didn't happen". A claim whose
  // window missed the event does NOT settle the entity: a later claim may
  // legitimately verify it.
  const settledEntities = new Set<string>();

  for (const run of claims) {
    const keys = graph.entityKeysByRun.get(run.id) ?? [];
    if (keys.length === 0) {
      drop.unjoinable += 1;
      continue;
    }
    if (keys.length > 1) {
      throw new EngineError("verify", `claim run ${run.id} joins ${keys.length} entities — ambiguous claim`);
    }
    const entKey = keys[0];
    if (settledEntities.has(entKey)) {
      drop.duplicateClaim += 1;
      if (duplicateSamples.length < 5) duplicateSamples.push(entKey);
      continue;
    }

    const timeline = graph.eventsByEntity.get(entKey) ?? [];
    const runStartMs = Date.parse(run.startedAt);
    const windowMs = contract.windowDays * DAY_MS;
    // Half-open join window, consistent with the quality bars: [start, start + N·24h).
    const event = timeline.find((ev) => {
      if (ev.eventType !== contract.event.eventType) return false;
      const t = Date.parse(ev.occurredAt);
      return t >= runStartMs && t - runStartMs < windowMs;
    });
    if (!event) {
      drop.didNotHappen += 1;
      continue;
    }
    settledEntities.add(entKey);

    const anchorMs = Date.parse(event.occurredAt);
    const quality = evaluateQuality(contract.qualityBar, timeline, anchorMs);
    if (!quality.pass) {
      drop.failedQualityBar += 1;
      qualityFailures[quality.reason] = (qualityFailures[quality.reason] ?? 0) + 1;
      const samples = (qualityFailureSamples[quality.reason] ??= []);
      if (samples.length < 5) samples.push(entKey);
      continue;
    }

    verified.push({
      claimRunId: run.id,
      actorId: run.actorId,
      model: run.model,
      entityKey: entKey,
      outcomeEventId: event.id,
      occurredAt: event.occurredAt,
      slice: sliceOf(qualifyingTouches(graph, entKey, anchorMs)),
    });
  }

  const claimed = claims.length;
  const report: VerificationReport = {
    workflowId: contract.workflowId,
    claimed,
    verified,
    drop,
    qualityFailures,
    qualityFailureSamples,
    duplicateSamples,
    qualityPassPct: claimed === 0 ? 0 : R4_pct(verified.length, claimed),
  };

  const accounted =
    verified.length + drop.didNotHappen + drop.failedQualityBar + drop.unjoinable + drop.duplicateClaim;
  if (accounted !== claimed) {
    throw new EngineError("verify", `funnel conservation violated: ${claimed} claimed vs ${accounted} accounted`);
  }
  return report;
}

/**
 * Quality-bar boundary analysis (a discovery input): among verified outcomes,
 * how many had a bar-violating event land just OUTSIDE the bar — in
 * [t + barDays, t + widenedDays)? "9% come back after day 7."
 */
export function qualityBoundaryCount(
  graph: ContributionGraph,
  verified: VerifiedOutcome[],
  eventType: string,
  barDays: number,
  widenedDays: number
): number {
  let count = 0;
  for (const v of verified) {
    const anchorMs = Date.parse(v.occurredAt);
    const from = anchorMs + barDays * DAY_MS;
    const to = anchorMs + widenedDays * DAY_MS;
    const timeline = graph.eventsByEntity.get(v.entityKey) ?? [];
    if (
      timeline.some((ev) => {
        if (ev.eventType !== eventType) return false;
        const t = Date.parse(ev.occurredAt);
        return t >= from && t < to;
      })
    ) {
      count += 1;
    }
  }
  return count;
}
