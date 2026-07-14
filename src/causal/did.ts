/**
 * Grade B — natural experiments: proof mined from changes the customer
 * already made. Two forms:
 *
 * didStagedRollout — additive difference-in-differences over pod × period
 * cells, run PER SLICE (agent_only / assisted), because hybrid slices can
 * have opposite signs: the meetings agent's agent-only slice estimates
 * negative (clamped to 0, the negative preserved — that drives RETIRE) while
 * the assisted slice carries all the attribution.
 *
 * twoGroupRoutingGap — a recorded routing change left a slice uncovered; its
 * outcome rate, projected onto the covered side's ATTEMPTS (claims), is the
 * counterfactual. Attempts, not verified successes: projecting onto verified
 * would scale the counterfactual down by the verification rate and flatter
 * the agent. Same two-group arithmetic as a holdout, Grade B because the
 * split wasn't reserved in advance.
 *
 * Robustness on the DiD (disclosed, never ledger-moving): the pre-period gap
 * each slice nets out (parallel-trends is untestable in a 2×2 — the gap is
 * stated so nobody has to take it on faith), a Wald interval on the summed
 * counterfactual, break-even sensitivity, and — when the design declares
 * placebo arms — the same DiD run over pre-pre → pre, where the true effect
 * is zero. A placebo failure is disclosed, never absorbed.
 *
 * NOT channel attribution: no first/last-touch heuristics anywhere.
 */
import { clamp, settleCounterfactual } from "../numeric";
import { Z95, wilson } from "./stats";
import { breakEven, signedRound } from "./robustness";
import type { ContributionGraph } from "../join/graph";
import { armCell } from "./cells";
import type { EstimatorResult, RobustnessReport, SliceEstimate, SliceId, VerificationReport } from "../types";
import { EngineError, MissingDesignDataError } from "../types";

export function estimateDidStagedRollout(
  graph: ContributionGraph,
  report: VerificationReport,
  design: {
    slices: Array<{
      slice: SliceId;
      experimentId: string;
      arms: { treatedPre: string; controlPre: string; controlPost: string; treatedPost: string };
      placebo?: { arms: { prePreTreated: string; prePreControl: string }; maxAbsDeltaPts: number };
    }>;
  }
): EstimatorResult {
  const verifiedBySlice = new Map<SliceId, number>();
  for (const v of report.verified) {
    verifiedBySlice.set(v.slice, (verifiedBySlice.get(v.slice) ?? 0) + 1);
  }
  const configured = new Set(design.slices.map((s) => s.slice));
  for (const [slice, count] of verifiedBySlice) {
    if (!configured.has(slice)) {
      throw new EngineError("estimate", `${count} verified outcomes in slice ${slice} but the design has no cells for it`);
    }
  }

  const perSlice: SliceEstimate[] = [];
  const cells: Record<string, { n: number; k: number }> = {};
  const notes: string[] = [];
  const placeboNotes: string[] = [];
  let attributable = 0;
  let cfLoSum = 0;
  let cfHiSum = 0;
  let worstPlaceboPts = 0;
  let placeboLimitPts = 0;
  let placeboPass = true;
  let placeboRan = false;

  for (const sliceDesign of design.slices) {
    const { slice, experimentId, arms } = sliceDesign;
    const preT = armCell(graph, experimentId, arms.treatedPre);
    const preC = armCell(graph, experimentId, arms.controlPre);
    const postC = armCell(graph, experimentId, arms.controlPost);
    const postT = armCell(graph, experimentId, arms.treatedPost);

    const verifiedSlice = verifiedBySlice.get(slice) ?? 0;
    if (postT.k !== verifiedSlice) {
      throw new EngineError(
        "estimate",
        `slice ${slice}: treated-post cell has ${postT.k} contract-satisfying entities but ${verifiedSlice} verified via claims — the join and the design disagree`
      );
    }

    // Additive DiD: expected treated-post rate had the rollout not happened.
    const expectedRate = preT.k / preT.n + (postC.k / postC.n - preC.k / preC.n);
    const cfRaw = expectedRate * postT.n;
    const settled = settleCounterfactual(verifiedSlice, cfRaw);
    attributable += settled.attributable;

    // The pre-period gap this slice's DiD nets out — stated, not assumed away.
    const preGapPts = signedRound((preT.k / preT.n - preC.k / preC.n) * 100, 1);
    notes.push(
      `${slice}: pre-period treated−control gap ${preGapPts >= 0 ? "+" : ""}${preGapPts}pts is netted out by the DiD (parallel trends carries it forward).`
    );

    // Wald variance of the expected rate from its three estimated cells,
    // projected to a counterfactual-count band for this slice.
    const cellVar = (cell: { n: number; k: number }) => {
      const p = cell.k / cell.n;
      return (p * (1 - p)) / cell.n;
    };
    const sdCf = postT.n * Math.sqrt(cellVar(preT) + cellVar(preC) + cellVar(postC));
    cfLoSum += clamp(cfRaw - Z95 * sdCf, 0, postT.n);
    cfHiSum += clamp(cfRaw + Z95 * sdCf, 0, postT.n);

    // Placebo: rerun the DiD over pre-pre → pre, where the true effect is zero.
    if (sliceDesign.placebo) {
      placeboLimitPts = Math.max(placeboLimitPts, sliceDesign.placebo.maxAbsDeltaPts);
      try {
        const ppT = armCell(graph, experimentId, sliceDesign.placebo.arms.prePreTreated);
        const ppC = armCell(graph, experimentId, sliceDesign.placebo.arms.prePreControl);
        const placeboPts = signedRound(
          ((preT.k / preT.n - ppT.k / ppT.n) - (preC.k / preC.n - ppC.k / ppC.n)) * 100,
          1
        );
        const pass = Math.abs(placeboPts) <= sliceDesign.placebo.maxAbsDeltaPts;
        placeboRan = true;
        worstPlaceboPts = Math.max(worstPlaceboPts, Math.abs(placeboPts));
        if (!pass) placeboPass = false;
        placeboNotes.push(
          `${slice}: placebo DiD over pre-pre → pre estimates ${placeboPts >= 0 ? "+" : ""}${placeboPts}pts where truth is 0 (limit ±${sliceDesign.placebo.maxAbsDeltaPts}pts) — ${pass ? "pass" : "FAIL: the design moves when nothing happened; treat the estimate as fragile"}.`
        );
      } catch (err) {
        if (!(err instanceof MissingDesignDataError)) throw err;
        notes.push(`${slice}: placebo configured but its pre-pre arm data is missing — placebo not run.`);
      }
    }

    perSlice.push({
      slice,
      verified: verifiedSlice,
      counterfactual: settled.counterfactual,
      attributable: settled.attributable,
      pointDelta: verifiedSlice - Math.max(0, cfRaw),
      cells: {
        treatedPre: { n: preT.n, k: preT.k },
        controlPre: { n: preC.n, k: preC.k },
        controlPost: { n: postC.n, k: postC.k },
        treatedPost: { n: postT.n, k: postT.k },
      },
    });
    for (const [name, cell] of Object.entries(perSlice[perSlice.length - 1].cells)) {
      cells[`${slice}.${name}`] = cell;
    }
  }

  const verified = report.verified.length;
  const counterfactualCount = verified - attributable;

  const robustness: RobustnessReport = {};
  const be = breakEven(verified, counterfactualCount);
  if (be) robustness.breakEven = be;
  if (placeboRan) {
    robustness.placebo = {
      deltaPts: signedRound(worstPlaceboPts, 1),
      maxAbsDeltaPts: placeboLimitPts,
      pass: placeboPass,
      notes: placeboNotes,
    };
  }

  return {
    grade: "B",
    designKind: "naturalExperiment",
    counterfactualCount,
    attributable,
    incrementality: { num: attributable, den: verified },
    interval:
      verified > 0
        ? {
            lo: clamp(1 - cfHiSum / verified, 0, 1),
            hi: clamp(1 - cfLoSum / verified, 0, 1),
            level: 0.95,
            method: "did-wald-additive",
          }
        : undefined,
    robustness,
    perSlice,
    cells,
    assumptions: [
      "Parallel trends: treated and control pods would have moved together absent the rollout.",
      "Rollout timing recorded and independent of outcome propensity.",
      "Negative slice estimates are clamped to zero attribution; the negative point delta is preserved as evidence.",
      "Interval sums per-slice Wald bands on the expected rate — conservative (assumes worst-case dependence across slices).",
    ],
    notes: [
      ...perSlice.map(
        (s) =>
          `${s.slice}: ${s.verified} verified vs ${s.counterfactual} expected anyway (point delta ${s.pointDelta >= 0 ? "+" : ""}${s.pointDelta.toFixed(1)}).`
      ),
      ...notes,
    ],
  };
}

export function estimateTwoGroupRoutingGap(
  graph: ContributionGraph,
  report: VerificationReport,
  design: { experimentId: string; controlArm: string }
): EstimatorResult {
  const control = armCell(graph, design.experimentId, design.controlArm);
  const verified = report.verified.length;
  const attempts = report.claimed;

  // Project the uncovered slice's rate onto covered ATTEMPTS (see header).
  const rC = control.k / control.n;
  const { counterfactual, attributable } = settleCounterfactual(verified, rC * attempts);

  const wC = wilson(control.k, control.n);
  const cfHi = Math.min(verified, Math.round(wC.hi * attempts));
  const cfLo = Math.min(verified, Math.round(wC.lo * attempts));

  const robustness: RobustnessReport = {};
  const be = breakEven(verified, counterfactual);
  if (be) robustness.breakEven = be;

  return {
    grade: "B",
    designKind: "naturalExperiment",
    counterfactualCount: counterfactual,
    attributable,
    incrementality: { num: attributable, den: verified },
    interval: {
      lo: clamp(1 - cfHi / verified, 0, 1),
      hi: clamp(1 - cfLo / verified, 0, 1),
      level: 0.95,
      method: "wilson-newcombe",
    },
    robustness,
    cells: { control: { n: control.n, k: control.k }, treated: { n: attempts, k: verified } },
    assumptions: [
      "The uncovered routing slice's outcome rate is the counterfactual rate for covered attempts.",
      "Routing assignment recorded; not reserved in advance (hence Grade B, not A).",
    ],
    notes: [
      `Uncovered slice produced ${control.k}/${control.n}; projected onto ${attempts} covered attempts → ${counterfactual} of ${verified} verified would have happened anyway.`,
    ],
  };
}
