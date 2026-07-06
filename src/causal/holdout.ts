/**
 * Grade A — holdout. A slice of work the agents never touch, assignment
 * recorded per unit. The engine reads recorded arms; it never randomizes.
 *
 * counterfactual = R1(k_c · n_t / n_c): the control arm's quality-passing
 * rate projected onto the treated arm, rounded once. Support's published
 * cells make this exact: 90 × 3,523 / 390 = 813.
 */
import { clamp, settleCounterfactual } from "../numeric";
import { wilson } from "./stats";
import type { ContributionGraph } from "../join/graph";
import { armCell } from "./cells";
import type { EstimatorResult, VerificationReport } from "../types";
import { EngineError } from "../types";

export function estimateHoldout(
  graph: ContributionGraph,
  report: VerificationReport,
  design: { experimentId: string; treatedArm: string; controlArm: string }
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

  return {
    grade: "A",
    designKind: "holdout",
    counterfactualCount: counterfactual,
    attributable,
    incrementality: { num: attributable, den: verified },
    interval: { lo, hi, level: 0.95, method: "wilson-newcombe" },
    cells: {
      treated: { n: treated.n, k: verified },
      control: { n: control.n, k: control.k },
    },
    assumptions: [
      "Assignment recorded at unit level before the period; the engine reads arms, it does not randomize.",
      "Exclusion verified: no agent-class touch exists on any control-arm entity.",
    ],
    notes: [
      `Control quality-passing rate ${control.k}/${control.n} projected onto ${treated.n} treated units → ${counterfactual} would have happened anyway.`,
    ],
  };
}
