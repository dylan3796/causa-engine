/**
 * Grade A — holdout. A slice of work the agents never touch, assignment
 * recorded per unit. The engine reads recorded arms; it never randomizes.
 *
 * counterfactual = R1(k_c · n_t / n_c): the control arm's quality-passing
 * rate projected onto the treated arm, rounded once. Support's published
 * cells make this exact: 90 × 3,523 / 390 = 813.
 *
 * Robustness (disclosed, never ledger-moving): break-even sensitivity always;
 * when the design declares `stratifyBy`, a post-stratified counterfactual —
 * per-stratum control rates weighted by the treated stratum mix — plus the
 * arm-balance table it is computed from. Post-stratification is the
 * categorical form of regression adjustment: if the arms are mix-imbalanced,
 * the adjusted and primary counterfactuals diverge, and the statement says so.
 */
import { clamp, settleCounterfactual } from "../numeric";
import { wilson } from "./stats";
import { breakEven, signedRound } from "./robustness";
import type { ContributionGraph } from "../join/graph";
import { entitySatisfiesContract } from "../verify/verify";
import { armCell } from "./cells";
import type { EstimatorResult, RobustnessReport, VerificationReport } from "../types";
import { EngineError } from "../types";

/** Stratum value: the first (timeline-ordered) outcome event carrying the field. */
function stratumOf(graph: ContributionGraph, entKey: string, field: string): string {
  for (const ev of graph.eventsByEntity.get(entKey) ?? []) {
    const value = ev.fields?.[field];
    if (value !== undefined) return String(value);
  }
  return "(unstratified)";
}

type PostStratified = NonNullable<RobustnessReport["postStratified"]>;

function postStratify(
  graph: ContributionGraph,
  field: string,
  treatedEntities: Set<string>,
  controlEntities: Set<string>,
  verified: number,
  primaryCf: number
): PostStratified | { skippedNote: string } {
  const strata = new Map<string, { treated: { n: number; k: number }; control: { n: number; k: number } }>();
  const cellFor = (stratum: string) => {
    let cell = strata.get(stratum);
    if (!cell) strata.set(stratum, (cell = { treated: { n: 0, k: 0 }, control: { n: 0, k: 0 } }));
    return cell;
  };
  for (const entKey of treatedEntities) {
    const cell = cellFor(stratumOf(graph, entKey, field)).treated;
    cell.n += 1;
    if (entitySatisfiesContract(graph, entKey)) cell.k += 1;
  }
  for (const entKey of controlEntities) {
    const cell = cellFor(stratumOf(graph, entKey, field)).control;
    cell.n += 1;
    if (entitySatisfiesContract(graph, entKey)) cell.k += 1;
  }

  const nT = treatedEntities.size;
  const nC = controlEntities.size;
  let cfRaw = 0;
  let maxShareDivergencePts = 0;
  const rows: Array<{ stratum: string; treated: { n: number; k: number }; control: { n: number; k: number } }> = [];
  for (const [stratum, cell] of [...strata.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    rows.push({ stratum, treated: cell.treated, control: cell.control });
    if (cell.treated.n > 0 && cell.control.n === 0) {
      return {
        skippedNote: `Post-stratification by '${field}' skipped: treated stratum '${stratum}' has no control entities to project from.`,
      };
    }
    if (cell.control.n > 0) cfRaw += (cell.control.k / cell.control.n) * cell.treated.n;
    const divergencePts = Math.abs(cell.treated.n / nT - cell.control.n / nC) * 100;
    maxShareDivergencePts = Math.max(maxShareDivergencePts, divergencePts);
  }

  const settled = settleCounterfactual(verified, cfRaw);
  const divergedPts = verified > 0 ? (Math.abs(settled.counterfactual - primaryCf) / verified) * 100 : 0;
  const agreesWithPrimary = divergedPts <= 5;
  return {
    counterfactual: settled.counterfactual,
    attributable: settled.attributable,
    strata: rows,
    maxShareDivergencePts: signedRound(maxShareDivergencePts, 1),
    agreesWithPrimary,
    note: agreesWithPrimary
      ? `Post-stratified counterfactual ${settled.counterfactual} agrees with the primary ${primaryCf} (gap ${signedRound(divergedPts, 1)}% of verified ≤ 5%): the arms are mix-balanced on '${field}'.`
      : `Post-stratified counterfactual ${settled.counterfactual} diverges from the primary ${primaryCf} by ${signedRound(divergedPts, 1)}% of verified: the arms are mix-imbalanced on '${field}' — the adjusted figure is the fragility bound.`,
  };
}

export function estimateHoldout(
  graph: ContributionGraph,
  report: VerificationReport,
  design: { experimentId: string; treatedArm: string; controlArm: string; stratifyBy?: { field: string } }
): EstimatorResult {
  const treated = armCell(graph, design.experimentId, design.treatedArm);
  const control = armCell(graph, design.experimentId, design.controlArm);

  // Exclusion check — the design's load-bearing assumption, verified, not assumed:
  // no agent-class touch may exist on any control entity.
  for (const entKey of control.entities) {
    const touched = (graph.touchesByEntity.get(entKey) ?? []).some((t) => t.actorClass === "agent");
    if (touched) {
      throw new EngineError("estimate", `holdout exclusion violated: agent touched control entity ${entKey}`);
    }
  }
  for (const v of report.verified) {
    if (!treated.entities.has(v.entityKey)) {
      throw new EngineError("estimate", `verified entity ${v.entityKey} is not in the treated arm`);
    }
  }

  const verified = report.verified.length;
  const { counterfactual, attributable } = settleCounterfactual(verified, (control.k * treated.n) / control.n);

  // Incrementality bounds by conservative substitution of the Wilson bounds
  // of the two rates: inc = 1 − r_c/r_t.
  const wT = wilson(verified, treated.n);
  const wC = wilson(control.k, control.n);
  const lo = wT.lo > 0 ? clamp(1 - wC.hi / wT.lo, 0, 1) : 0;
  const hi = wT.hi > 0 ? clamp(1 - wC.lo / wT.hi, 0, 1) : 0;

  const robustness: RobustnessReport = {};
  const notes = [
    `Control quality-passing rate ${control.k}/${control.n} projected onto ${treated.n} treated units → ${counterfactual} would have happened anyway.`,
  ];
  const be = breakEven(verified, counterfactual);
  if (be) robustness.breakEven = be;
  if (design.stratifyBy) {
    const ps = postStratify(graph, design.stratifyBy.field, treated.entities, control.entities, verified, counterfactual);
    if ("skippedNote" in ps) notes.push(ps.skippedNote);
    else robustness.postStratified = ps;
  }

  return {
    grade: "A",
    designKind: "holdout",
    counterfactualCount: counterfactual,
    attributable,
    incrementality: { num: attributable, den: verified },
    interval: { lo, hi, level: 0.95, method: "wilson-newcombe" },
    robustness,
    cells: {
      treated: { n: treated.n, k: verified },
      control: { n: control.n, k: control.k },
    },
    assumptions: [
      "Assignment recorded at unit level before the period; the engine reads arms, it does not randomize.",
      "Exclusion verified: no agent-class touch exists on any control-arm entity.",
    ],
    notes,
  };
}
