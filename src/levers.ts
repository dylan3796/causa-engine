/**
 * Levers — deterministic what-if arithmetic over settled statements and
 * observatory reports, answering the operator's three questions:
 *
 *   SCALE       more inputs?          project volume at observed rates
 *   MIX         different inputs?     shift work toward the segment that wins
 *   SUBSTITUTE  different agent?      rank $/outcome, read the verdicts
 *
 * These are projections, not promises: every card declares the assumption it
 * rides on (rates hold, parity holds, segments stay comparable). Settled
 * workflows project on ATTRIBUTABLE outcomes; observatory agents project on
 * observed output and say so.
 */
import { R3_dollars, roundHalfUp } from "./numeric";
import type { LedgerStatement, WorkflowStatement } from "./types";
import type { AgentObservation, ObservatoryReport } from "./outcomes/observatory";

/* --------------------------------- SCALE ------------------------------------ */

export interface ScaleProjection {
  addedClaims: number;
  projectedVerified: number;
  projectedAttributable: number;
  projectedSpendCents: number;
  assumptions: string[];
}

/** Project a settled workflow at +addedClaims volume, holding observed rates. */
export function projectScale(w: WorkflowStatement, addedClaims: number): ScaleProjection {
  const verifyRate = w.verified / w.claimed;
  const attributableRate = w.attributable / Math.max(1, w.verified);
  const spendPerClaim = w.spendCents / w.claimed;
  const projectedVerified = roundHalfUp(addedClaims * verifyRate);
  return {
    addedClaims,
    projectedVerified,
    projectedAttributable: roundHalfUp(projectedVerified * attributableRate),
    projectedSpendCents: roundHalfUp(addedClaims * spendPerClaim),
    assumptions: [
      `Holds this period's rates constant: ${Math.round(verifyRate * 100)}% verify, ${Math.round(attributableRate * 100)}% of verified attributable, spend ${(spendPerClaim / 100).toFixed(2)}/claim.`,
      "Linear extrapolation — watch for saturation of the input pool; the incrementality rate itself can fall as volume grows.",
      w.estimator.grade === "A"
        ? "Keep the holdout intact while scaling, or the next statement loses its Grade A evidence."
        : `Evidence grade ${w.estimator.grade}: re-verify the counterfactual after any large volume change.`,
    ],
  };
}

/** Observatory version: project observed output at +addedRuns, at observed cost. */
export function projectObservedScale(a: AgentObservation, addedRuns: number) {
  const primary = a.outputs[0];
  const outputsPerRun = primary ? primary.count / Math.max(1, a.runs) : 0;
  const spendPerRun = a.spendCents / Math.max(1, a.runs);
  return {
    addedRuns,
    projectedOutcomes: roundHalfUp(addedRuns * outputsPerRun),
    projectedSpendCents: roundHalfUp(addedRuns * spendPerRun),
    outputLabel: primary ? `${primary.eventType} (${primary.source})` : "—",
    assumptions: [
      "Observed-output projection (no counterfactual yet): confirm a contract and baseline before treating this as attributable value.",
    ],
  };
}

/* ---------------------------------- MIX -------------------------------------- */

export interface MixOption {
  name: string;
  detail: string;
  /** Projected monthly delta of adopting this option, when computable. */
  impactPerMonthDollars?: number;
}

/** Segment-shift options a settled workflow already contains evidence for. */
export function mixOptions(w: WorkflowStatement): MixOption[] {
  const options: MixOption[] = [];

  if (w.modelSplit && w.modelSplit.length > 1) {
    const sorted = [...w.modelSplit].sort((a, b) => a.marginalCostPerVerifiedCents - b.marginalCostPerVerifiedCents);
    const cheap = sorted[0];
    const dear = sorted[sorted.length - 1];
    const savings = dear.marginalCostPerVerifiedCents - cheap.marginalCostPerVerifiedCents;
    options.push({
      name: `Shift work from ${dear.model} to ${cheap.model}`,
      detail: `Marginals ${(dear.marginalCostPerVerifiedCents / 100).toFixed(2)} vs ${(cheap.marginalCostPerVerifiedCents / 100).toFixed(2)} per verified outcome. Quality parity must hold — the model-switch companion checks it.`,
      impactPerMonthDollars: R3_dollars((savings * dear.verified) / 100),
    });
  }

  if (w.estimator.perSlice && w.estimator.perSlice.length > 1) {
    const best = [...w.estimator.perSlice].sort((a, b) => b.attributable - a.attributable)[0];
    const worst = [...w.estimator.perSlice].sort((a, b) => a.pointDelta - b.pointDelta)[0];
    if (best.slice !== worst.slice) {
      options.push({
        name: `Route inputs toward the "${best.slice}" pattern`,
        detail:
          `"${best.slice}" carries ${best.attributable} attributable outcomes; "${worst.slice}" shows a ${worst.pointDelta.toFixed(1)} point delta` +
          (worst.pointDelta <= 0 ? " — it is not beating doing nothing." : "."),
      });
    }
  }

  if (options.length === 0) {
    options.push({
      name: "No measured segments yet",
      detail: "Record a model switch, a routing change, or a staged rollout — the engine turns any of them into Grade B evidence for a mix decision.",
    });
  }
  return options;
}

/* ------------------------------- SUBSTITUTE ---------------------------------- */

export interface SubstitutionRow {
  name: string;
  verdict?: string;
  costPerAttributableCents?: number;
  costPerOutcomeCents?: number;
  outcomeLabel: string;
  stance: string;
}

/** Rank a settled statement's workflows by what an attributable outcome costs. */
export function substitutionTable(s: LedgerStatement): SubstitutionRow[] {
  return s.workflows
    .map((w) => ({
      name: w.workflowId,
      verdict: w.verdict.verdict,
      costPerAttributableCents: w.attributable > 0 ? roundHalfUp(w.spendCents / w.attributable) : undefined,
      outcomeLabel: "attributable outcome",
      stance:
        w.verdict.verdict === "EXPAND"
          ? "working — scale it"
          : w.verdict.verdict === "RETIRE"
            ? "not beating doing nothing — reclaim the spend"
            : w.verdict.verdict === "REROUTE"
              ? "same quality available cheaper — switch the engine"
              : "priced above its contribution — renegotiate",
    }))
    .sort((a, b) => (a.costPerAttributableCents ?? Infinity) - (b.costPerAttributableCents ?? Infinity));
}

/** Observatory version: rank agents by observed cost per (primary) outcome. */
export function observedSubstitutionTable(o: ObservatoryReport): SubstitutionRow[] {
  return o.agents
    .map((a) => {
      const primary = a.outputs[0];
      return {
        name: a.actorId,
        costPerOutcomeCents: primary?.costPerOutcomeCents,
        outcomeLabel: primary ? `${primary.eventType} (observed)` : "no joined output",
        stance: primary
          ? `${primary.count} × ${primary.eventType} touched for ${(a.spendCents / 100).toFixed(2)} total`
          : `${a.runs} runs joined to nothing — invisible work or a missing join key`,
      };
    })
    .sort((a, b) => (a.costPerOutcomeCents ?? Infinity) - (b.costPerOutcomeCents ?? Infinity));
}
