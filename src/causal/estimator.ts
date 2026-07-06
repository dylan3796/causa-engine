/**
 * Estimator dispatch and the baseline ladder. Grades attach to the DESIGN,
 * not the formula — the same two-group arithmetic is Grade A when the control
 * was reserved in advance and Grade B when it was mined from a change already
 * made. Attribution is an integer counterfactual count, rounded exactly once
 * (R1), so integer ledgers reconcile.
 *
 * A baseline is ALWAYS measured. The primary design settles the workflow;
 * every corroborating design whose data exists runs too and is attached as
 * evidence (never averaged in). If the primary design's data is missing, the
 * engine walks the corroboration ladder to the best design that can run —
 * grade downgraded honestly, the fallback named — and only when nothing can
 * run does it bottom out at Grade D rules with the evidence-ceiling note.
 * Integrity violations are never walked past: they fail the statement.
 */
import type { ContributionGraph } from "../join/graph";
import type { CorroborationResult, CounterfactualDesign, EstimatorResult, VerificationReport } from "../types";
import { EngineError, MissingDesignDataError } from "../types";
import { estimateHoldout } from "./holdout";
import { estimateDidStagedRollout, estimateTwoGroupRoutingGap } from "./did";
import { estimatePreAgentBaseline } from "./baseline";
import { estimateRules } from "./rules";

function estimateDesign(
  graph: ContributionGraph,
  report: VerificationReport,
  design: CounterfactualDesign
): EstimatorResult {
  switch (design.kind) {
    case "holdout":
      return estimateHoldout(graph, report, design);
    case "naturalExperiment":
      return design.form === "didStagedRollout"
        ? estimateDidStagedRollout(graph, report, design)
        : estimateTwoGroupRoutingGap(graph, report, design);
    case "preAgentBaseline":
      return estimatePreAgentBaseline(report, design);
    case "rules":
      return estimateRules(graph, report, design);
    default: {
      const never: never = design;
      throw new EngineError("estimate", `unknown counterfactual design ${JSON.stringify(never)}`);
    }
  }
}

export function estimate(graph: ContributionGraph, report: VerificationReport): EstimatorResult {
  const contract = graph.contract;
  const ladder = contract.corroboration ?? [];

  let primary: EstimatorResult | undefined;
  const notes: string[] = [];
  let usedFromLadder = -1;

  try {
    primary = estimateDesign(graph, report, contract.counterfactual);
  } catch (err) {
    if (!(err instanceof MissingDesignDataError)) throw err;
    // Walk the ladder: the best corroborating design whose data exists
    // becomes the estimate — downgraded, named, never silent.
    for (let i = 0; i < ladder.length && !primary; i++) {
      try {
        primary = estimateDesign(graph, report, ladder[i]);
        usedFromLadder = i;
        notes.push(
          `Primary design (${contract.counterfactual.kind}) has no recorded data; fell back to corroborating ${ladder[i].kind} — evidence ceiling ${primary.grade}.`
        );
      } catch (ladderErr) {
        if (!(ladderErr instanceof MissingDesignDataError)) throw ladderErr;
      }
    }
    if (!primary) {
      primary = estimateRules(
        graph,
        report,
        { wouldHaveHappenedAnyway: { op: "or", of: [] } },
        `Evidence-grade ceiling: no configured design's data is present (${err.message}); downgraded to Grade D rules.`
      );
    }
  }

  const corroboration: CorroborationResult[] = [];
  for (let i = 0; i < ladder.length; i++) {
    if (i === usedFromLadder) continue;
    try {
      const { corroboration: _drop, ...result } = estimateDesign(graph, report, ladder[i]);
      corroboration.push(result);
    } catch (err) {
      if (!(err instanceof MissingDesignDataError)) throw err;
      notes.push(`Corroborating ${ladder[i].kind} skipped: its design data is missing.`);
    }
  }

  return {
    ...primary,
    notes: [...primary.notes, ...notes],
    corroboration: corroboration.length > 0 ? corroboration : undefined,
  };
}
