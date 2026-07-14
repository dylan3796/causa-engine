/**
 * Adversarial integrity checks over the claim stream. The moment money
 * settles on verified-outcome counts, the counts become a target: claim
 * stuffing, entity splitting, retroactive claiming, and window gaming are the
 * obvious plays. Every check here is deterministic and runs on every
 * statement.
 *
 * Doctrine: findings gate TRUST, never arithmetic. The funnel, estimate, and
 * verdict are computed exactly as they would be without these checks; a
 * warn/flag finding is a disclosed dispute trigger for a human, not an
 * automatic adjustment. (An automatic adjustment on a heuristic would be a
 * fabricated number — the thing this engine exists to refuse.)
 */
import { DAY_MS } from "../time";
import type { ContributionGraph } from "../join/graph";
import type { ActivityRun, IntegrityFinding, IntegrityReport, VerificationReport } from "../types";

export const INTEGRITY_THRESHOLDS = {
  /** duplicate-claim-rate: % of claims double-billing a settled entity. */
  duplicateWarnPct: 2,
  duplicateFlagPct: 5,
  /** retroactive-claims: claim stamped ≥ 24h after the outcome it asserts. */
  retroactiveLagMs: 24 * 3_600_000,
  retroactiveWarnPct: 1,
  retroactiveFlagPct: 5,
  /** claim-burst: one actor's max daily claims vs their median active day. */
  burstMinClaims: 30,
  burstWarnRatio: 5,
  burstWarnMax: 20,
  burstFlagRatio: 10,
  burstFlagMax: 50,
  /** entity-splitting: distinct claimed ids collapsing under canonicalization. */
  splitFlagPctOfEntities: 1,
  /** window-edge-concentration: verified outcomes landing in the window's last 10%. */
  edgeTailShare: 0.9,
  edgeWarnPct: 15,
  edgeFlagPct: 30,
  /** actor-verify-rate-outlier: per-actor verify rate vs the workflow's. */
  outlierMinClaims: 20,
  outlierDeltaPts: 25,
  /** Small-sample gate: rate checks need at least this many observations. */
  minSample: 20,
} as const;

/** Lower-middle median of a sorted copy — deterministic on even counts. */
function medianLowerMiddle(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

const pct = (num: number, den: number) => (den > 0 ? (100 * num) / den : 0);
const round1 = (x: number) => Math.floor(x * 10 + 0.5) / 10;

export function runIntegrity(graph: ContributionGraph, report: VerificationReport): IntegrityReport {
  const T = INTEGRITY_THRESHOLDS;
  const findings: IntegrityFinding[] = [];
  const contract = graph.contract;
  const claims = graph.workflowRuns.filter((r) => r.claim?.workflowId === contract.workflowId);
  const runsById = new Map(graph.workflowRuns.map((r) => [r.id, r]));
  const claimed = report.claimed;
  const verified = report.verified;

  // 1. duplicate-claim-rate — double-billing volume, not just its existence.
  if (claimed >= T.minSample) {
    const rate = round1(pct(report.drop.duplicateClaim, claimed));
    if (rate >= T.duplicateWarnPct) {
      findings.push({
        check: "duplicate-claim-rate",
        severity: rate >= T.duplicateFlagPct ? "flag" : "warn",
        observed: rate,
        threshold: rate >= T.duplicateFlagPct ? T.duplicateFlagPct : T.duplicateWarnPct,
        detail: `${report.drop.duplicateClaim} of ${claimed} claims (${rate}%) re-billed an already-settled entity.`,
        samples: report.duplicateSamples ?? [],
      });
    }
  }

  // 2. retroactive-claims — the claim postdates the outcome it asserts by ≥24h:
  // consistent with a vendor watching outcomes land and claiming them after the fact.
  if (verified.length >= T.minSample) {
    let retro = 0;
    const samples: string[] = [];
    for (const v of verified) {
      const run = runsById.get(v.claimRunId);
      const claimedAt = run?.claim ? Date.parse(run.claim.claimedAt) : NaN;
      if (Number.isFinite(claimedAt) && claimedAt - Date.parse(v.occurredAt) >= T.retroactiveLagMs) {
        retro += 1;
        if (samples.length < 5) samples.push(v.entityKey);
      }
    }
    const rate = round1(pct(retro, verified.length));
    if (rate >= T.retroactiveWarnPct) {
      findings.push({
        check: "retroactive-claims",
        severity: rate >= T.retroactiveFlagPct ? "flag" : "warn",
        observed: rate,
        threshold: rate >= T.retroactiveFlagPct ? T.retroactiveFlagPct : T.retroactiveWarnPct,
        detail: `${retro} of ${verified.length} verified outcomes (${rate}%) were claimed ≥ 24h AFTER the outcome occurred — claims should precede or accompany the outcome, not chase it.`,
        samples,
      });
    }
  }

  // 3. claim-burst — a stuffing signature: one actor's claim volume spiking
  // far above their own routine day.
  const byActor = new Map<string, ActivityRun[]>();
  for (const run of claims) {
    let list = byActor.get(run.actorId);
    if (!list) byActor.set(run.actorId, (list = []));
    list.push(run);
  }
  for (const [actorId, actorClaims] of [...byActor.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (actorClaims.length < T.burstMinClaims) continue;
    const daily = new Map<number, number>();
    for (const run of actorClaims) {
      const day = Math.floor(Date.parse(run.claim!.claimedAt) / DAY_MS);
      daily.set(day, (daily.get(day) ?? 0) + 1);
    }
    const counts = [...daily.values()];
    const max = Math.max(...counts);
    const median = Math.max(1, medianLowerMiddle(counts));
    const ratio = round1(max / median);
    const isFlag = ratio >= T.burstFlagRatio && max >= T.burstFlagMax;
    const isWarn = ratio >= T.burstWarnRatio && max >= T.burstWarnMax;
    if (isFlag || isWarn) {
      findings.push({
        check: "claim-burst",
        severity: isFlag ? "flag" : "warn",
        observed: ratio,
        threshold: isFlag ? T.burstFlagRatio : T.burstWarnRatio,
        detail: `${actorId}: peak day carried ${max} claims vs a median active day of ${median} (${ratio}×).`,
        samples: [actorId],
      });
    }
  }

  // 4. entity-splitting — distinct claimed ids that collapse under
  // canonicalization (case/punctuation) are the signature of one outcome
  // billed as several entities.
  const canonicalGroups = new Map<string, Set<string>>();
  for (const run of claims) {
    for (const entKey of graph.entityKeysByRun.get(run.id) ?? []) {
      const sep = entKey.indexOf(":");
      const canonical = `${entKey.slice(0, sep)}:${entKey.slice(sep + 1).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      let group = canonicalGroups.get(canonical);
      if (!group) canonicalGroups.set(canonical, (group = new Set()));
      group.add(entKey);
    }
  }
  const collisions = [...canonicalGroups.entries()]
    .filter(([, group]) => group.size > 1)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  if (collisions.length > 0) {
    const extraIds = collisions.reduce((acc, [, g]) => acc + g.size - 1, 0);
    const ratePct = round1(pct(extraIds, canonicalGroups.size));
    findings.push({
      check: "entity-splitting",
      severity: ratePct >= T.splitFlagPctOfEntities ? "flag" : "warn",
      observed: collisions.length,
      threshold: 1,
      detail: `${collisions.length} canonical entities were claimed under ${collisions.length + extraIds} distinct ids (e.g. case/punctuation variants) — possible double-billing via entity splitting.`,
      samples: collisions.slice(0, 5).map(([, group]) => [...group].sort().join(" ↔ ")),
    });
  }

  // 5. window-edge-concentration — natural run→outcome lags decay; a pile-up
  // just inside the join window's far edge is engineered timing.
  if (verified.length >= T.minSample) {
    const windowMs = contract.windowDays * DAY_MS;
    let tail = 0;
    const samples: string[] = [];
    for (const v of verified) {
      const run = runsById.get(v.claimRunId);
      if (!run) continue;
      const lag = Date.parse(v.occurredAt) - Date.parse(run.startedAt);
      if (lag >= T.edgeTailShare * windowMs) {
        tail += 1;
        if (samples.length < 5) samples.push(v.entityKey);
      }
    }
    const rate = round1(pct(tail, verified.length));
    if (rate >= T.edgeWarnPct) {
      findings.push({
        check: "window-edge-concentration",
        severity: rate >= T.edgeFlagPct ? "flag" : "warn",
        observed: rate,
        threshold: rate >= T.edgeFlagPct ? T.edgeFlagPct : T.edgeWarnPct,
        detail: `${tail} of ${verified.length} verified outcomes (${rate}%) landed in the final 10% of the ${contract.windowDays}-day join window — natural lag distributions decay, they do not pile up at the edge.`,
        samples,
      });
    }
  }

  // 6. actor-verify-rate-outlier — informational: an actor far below the
  // workflow's verify rate is a stuffing signal; far above alongside other
  // findings, a gaming signal.
  if (claimed >= T.minSample) {
    const overallPct = pct(verified.length, claimed);
    const verifiedByActor = new Map<string, number>();
    for (const v of verified) verifiedByActor.set(v.actorId, (verifiedByActor.get(v.actorId) ?? 0) + 1);
    for (const [actorId, actorClaims] of [...byActor.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (actorClaims.length < T.outlierMinClaims) continue;
      const actorPct = pct(verifiedByActor.get(actorId) ?? 0, actorClaims.length);
      const deltaPts = round1(Math.abs(actorPct - overallPct));
      if (deltaPts >= T.outlierDeltaPts) {
        findings.push({
          check: "actor-verify-rate-outlier",
          severity: "info",
          observed: deltaPts,
          threshold: T.outlierDeltaPts,
          detail: `${actorId}: verify rate ${round1(actorPct)}% vs workflow ${round1(overallPct)}% (Δ ${deltaPts}pts over ${actorClaims.length} claims).`,
          samples: [actorId],
        });
      }
    }
  }

  const rank = { flag: 0, warn: 1, info: 2 } as const;
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.check < b.check ? -1 : 1));
  return { workflowId: contract.workflowId, checksRun: 6, findings };
}
