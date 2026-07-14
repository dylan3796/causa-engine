/**
 * Grade C — pre-agent baseline: the customer's own history from before the
 * agents, matched and compared. Inputs are declared monthly aggregates,
 * honestly labeled as summaries (not events).
 *
 * basis "displacement": the outcomes would still occur under the old process
 * at baseline cost — attribution counts work performed, value is cost
 * displacement. This is why a 100%-quality internal agent can honestly show
 * claimed = verified = attributable without pretending the work wouldn't
 * otherwise exist.
 */
import { R1_count, settleCounterfactual } from "../numeric";
import { breakEven } from "./robustness";
import type { EstimatorResult, MonthlySummary, RobustnessReport, VerificationReport } from "../types";
import { EngineError } from "../types";

/** Lower-middle median of a sorted copy — deterministic on even counts. */
function medianLowerMiddle(values: number[]): number {
  if (values.length === 0) throw new EngineError("estimate", "median of empty baseline");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export function estimatePreAgentBaseline(
  report: VerificationReport,
  design: {
    basis: "displacement" | "occurrence";
    months: MonthlySummary[];
    match: { volumeTolerancePct: number; minMonths: number };
    seasonality: { comparisonMonth: string; maxDivergencePct: number };
  }
): EstimatorResult {
  const verified = report.verified.length;
  const assumptions: string[] = [];

  let matched = design.months.filter(
    (m) => Math.abs(m.volume - verified) / verified <= design.match.volumeTolerancePct / 100
  );
  if (matched.length < design.match.minMonths) {
    const matchedCount = matched.length;
    matched = design.months;
    assumptions.push(
      `Only ${matchedCount} baseline months matched volume ±${design.match.volumeTolerancePct}%; all ${design.months.length} months used instead.`
    );
  }
  const baselineCostPerOutcomeCents = medianLowerMiddle(matched.map((m) => m.costPerOutcomeCents));

  const seasonal = design.months.find((m) => m.month === design.seasonality.comparisonMonth);
  if (seasonal) {
    const divergencePct = (Math.abs(verified - seasonal.volume) / seasonal.volume) * 100;
    if (divergencePct > design.seasonality.maxDivergencePct) {
      assumptions.push(
        `Seasonality guard: volume diverges ${divergencePct.toFixed(1)}% from ${seasonal.month} (limit ${design.seasonality.maxDivergencePct}%).`
      );
    }
  } else {
    assumptions.push(`Seasonality guard skipped: no baseline month ${design.seasonality.comparisonMonth}.`);
  }

  let cfRaw: number;
  if (design.basis === "displacement") {
    cfRaw = 0;
    assumptions.push(
      "Displacement basis: outcomes would occur under the pre-agent process at baseline cost; attribution counts work performed, value is cost displacement."
    );
  } else {
    // occurrence basis: at baseline volume, that many outcomes happen anyway.
    cfRaw = R1_count(medianLowerMiddle(matched.map((m) => m.volume)));
    assumptions.push("Occurrence basis: matched-median baseline volume would have occurred without the agent.");
  }

  const { counterfactual, attributable } = settleCounterfactual(verified, cfRaw);

  // Robustness: leave-one-out over the matched months. On the occurrence
  // basis the counterfactual is the matched-median volume, so LOO bounds the
  // attributable count; on displacement the counterfactual is structurally 0,
  // so LOO bounds the baseline unit cost that EXPAND and the dispute consume.
  const robustness: RobustnessReport = {};
  const be = breakEven(verified, counterfactual);
  if (be) robustness.breakEven = be;
  if (matched.length >= 2) {
    if (design.basis === "occurrence") {
      let attrLo = Infinity;
      let attrHi = -Infinity;
      for (let drop = 0; drop < matched.length; drop++) {
        const rest = matched.filter((_, i) => i !== drop);
        const looCf = R1_count(medianLowerMiddle(rest.map((m) => m.volume)));
        const looAttr = settleCounterfactual(verified, looCf).attributable;
        attrLo = Math.min(attrLo, looAttr);
        attrHi = Math.max(attrHi, looAttr);
      }
      robustness.leaveOneOut = {
        lo: attrLo,
        hi: attrHi,
        metric: "attributable",
        note: `Dropping any single matched month moves attributable within [${attrLo}, ${attrHi}] — the estimate does not hinge on one month.`,
      };
    } else {
      let costLo = Infinity;
      let costHi = -Infinity;
      for (let drop = 0; drop < matched.length; drop++) {
        const rest = matched.filter((_, i) => i !== drop);
        const looCost = medianLowerMiddle(rest.map((m) => m.costPerOutcomeCents));
        costLo = Math.min(costLo, looCost);
        costHi = Math.max(costHi, looCost);
      }
      robustness.leaveOneOut = {
        lo: costLo,
        hi: costHi,
        metric: "baselineCostPerOutcomeCents",
        note: `Dropping any single matched month moves the baseline cost/outcome within [${costLo}, ${costHi}] cents.`,
      };
    }
  }

  return {
    grade: "C",
    designKind: "preAgentBaseline",
    counterfactualCount: counterfactual,
    attributable,
    incrementality: { num: attributable, den: verified },
    robustness,
    cells: { matchedMonths: { n: design.months.length, k: matched.length } },
    assumptions,
    notes: [
      `Matched ${matched.length}/${design.months.length} baseline months (volume ±${design.match.volumeTolerancePct}% of ${verified}); median cost/outcome $${(baselineCostPerOutcomeCents / 100).toFixed(2)} under the old process.`,
    ],
    baselineCostPerOutcomeCents,
  };
}
