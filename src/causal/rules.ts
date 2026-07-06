/**
 * Grade D — rule-based counterfactuals: sound logic over the contribution
 * graph. Where every engagement starts; never where it has to end. Also the
 * evidence-grade CEILING fallback: when a contract's design data is missing,
 * the statement downgrades here and says so.
 */
import { settleCounterfactual } from "../numeric";
import type { ContributionGraph } from "../join/graph";
import { qualifyingTouches } from "../join/contribution";
import type { MetricRecord, Predicate } from "../predicates";
import { evalPredicate } from "../predicates";
import type { EstimatorResult, VerificationReport, VerifiedOutcome } from "../types";

/** Per-outcome metrics the rule predicate can reference. */
export function outcomeMetrics(graph: ContributionGraph, v: VerifiedOutcome): MetricRecord {
  const touches = qualifyingTouches(graph, v.entityKey, Date.parse(v.occurredAt));
  const claimTouch = touches.find((t) => t.runId === v.claimRunId);
  const priorHuman = touches.some(
    (t) => t.actorClass === "human" && (claimTouch ? t.startedAtMs < claimTouch.startedAtMs : true)
  );
  return {
    slice: v.slice,
    agentTouchCount: touches.filter((t) => t.actorClass === "agent").length,
    humanTouchCount: touches.filter((t) => t.actorClass === "human").length,
    hasPriorHumanTouch: priorHuman,
  };
}

export function estimateRules(
  graph: ContributionGraph,
  report: VerificationReport,
  design: { wouldHaveHappenedAnyway: Predicate },
  gradeCeilingNote?: string
): EstimatorResult {
  const verified = report.verified.length;
  let matchedCount = 0;
  for (const v of report.verified) {
    if (evalPredicate(design.wouldHaveHappenedAnyway, outcomeMetrics(graph, v))) matchedCount += 1;
  }
  const { counterfactual, attributable } = settleCounterfactual(verified, matchedCount);
  const notes = [
    `Rule-based counterfactual: ${counterfactual} of ${verified} verified outcomes match the would-have-happened-anyway predicate.`,
  ];
  if (gradeCeilingNote) notes.push(gradeCeilingNote);
  return {
    grade: "D",
    designKind: "rules",
    counterfactualCount: counterfactual,
    attributable,
    incrementality: { num: attributable, den: verified },
    cells: { verified: { n: verified, k: counterfactual } },
    assumptions: [
      "Counterfactual is deterministic rule logic, not an experiment — the evidence-grade floor.",
    ],
    notes,
  };
}
