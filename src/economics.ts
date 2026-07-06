/**
 * Economics: spend by billing kind, cost per verified outcome, per-model
 * splits (model is a recorded attribute of every run — §6.4), and the
 * dispute math for per-outcome billing.
 *
 * Note on marginals vs the row rate: a vendor's billed $/verified can
 * legitimately exceed every model's marginal cost, because per-claim billing
 * pays for failed claims too. The engine makes that arithmetic explicit.
 */
import { R2_unitCents, R4_pct, R4_share2, roundHalfUp } from "./numeric";
import type {
  ActivityRun,
  DisputeBlock,
  EconomicsReport,
  EstimatorResult,
  ModelSplitEntry,
  OutcomeContract,
  VerificationReport,
} from "./types";
import { EngineError } from "./types";

export function computeEconomics(
  contract: OutcomeContract,
  report: VerificationReport,
  workflowRuns: ActivityRun[]
): EconomicsReport {
  const verified = report.verified.length;
  if (verified === 0) throw new EngineError("economics", `${contract.workflowId}: no verified outcomes`);

  let spendCents: number;
  switch (contract.billing.kind) {
    case "perOutcome":
      spendCents = report.claimed * contract.billing.rateCents;
      break;
    case "flatMonthly":
      spendCents = contract.billing.feeCents;
      break;
    case "usage":
      spendCents = workflowRuns.reduce((acc, r) => acc + r.costCents, 0);
      break;
  }

  const runsById = new Map(workflowRuns.map((r) => [r.id, r]));

  // Verified outcomes and their claiming-run costs, grouped by model.
  const byModel = new Map<string, { verified: number; claimCostCents: number }>();
  for (const v of report.verified) {
    if (!v.model) continue;
    const run = runsById.get(v.claimRunId);
    if (!run) throw new EngineError("economics", `verified claim run ${v.claimRunId} missing from workflow runs`);
    const entry = byModel.get(v.model) ?? { verified: 0, claimCostCents: 0 };
    entry.verified += 1;
    entry.claimCostCents += run.costCents;
    byModel.set(v.model, entry);
  }

  let modelSplit: ModelSplitEntry[] | undefined;
  if (byModel.size > 1) {
    modelSplit = [...byModel.entries()]
      .map(([model, e]) => ({
        model,
        verified: e.verified,
        share: R4_share2(e.verified, verified),
        marginalCostPerVerifiedCents: R2_unitCents(e.claimCostCents, e.verified),
      }))
      .sort((a, b) => b.verified - a.verified || (a.model < b.model ? -1 : 1));
  }

  let modelSwitch: EconomicsReport["modelSwitch"];
  if (contract.modelSwitchCompanion) {
    const { incumbentModel, altModel } = contract.modelSwitchCompanion;
    const claimsByModel = new Map<string, number>();
    for (const run of workflowRuns) {
      if (run.claim?.workflowId !== contract.workflowId || !run.model) continue;
      claimsByModel.set(run.model, (claimsByModel.get(run.model) ?? 0) + 1);
    }
    const cell = (model: string) => {
      const claims = claimsByModel.get(model);
      const e = byModel.get(model);
      if (!claims || !e) throw new EngineError("economics", `model-switch companion: no data for model ${model}`);
      return { claims, verified: e.verified, marginal: R2_unitCents(e.claimCostCents, e.verified) };
    };
    const inc = cell(incumbentModel);
    const alt = cell(altModel);
    const incumbentAcceptPct = R4_pct(inc.verified, inc.claims);
    const altAcceptPct = R4_pct(alt.verified, alt.claims);
    modelSwitch = {
      incumbentModel,
      altModel,
      incumbentAcceptPct,
      altAcceptPct,
      // Parity on raw percentage points, |Δ| ≤ 1pt.
      parity: Math.abs((100 * inc.verified) / inc.claims - (100 * alt.verified) / alt.claims) <= 1,
      savingsPerVerifiedCents: inc.marginal - alt.marginal,
    };
  }

  return {
    spendCents,
    costPerVerifiedCents: R2_unitCents(spendCents, verified),
    modelSplit,
    modelSwitch,
  };
}

/**
 * Dispute math for per-outcome billing. The published support chain, in
 * order (R5 — rounded operands feed derived deltas):
 *   fair price  = R2(150¢ × 1989/2802) = 106¢
 *   delta       = 150 − 106 = 44¢
 *   adjustment  = 61 quality failures × 150¢ = $91.50
 */
export function computeDispute(
  contract: OutcomeContract,
  report: VerificationReport,
  estimator: EstimatorResult
): DisputeBlock | undefined {
  if (contract.billing.kind !== "perOutcome") return undefined;
  const rate = contract.billing.rateCents;
  const verified = report.verified.length;
  const qualityFailures = Object.values(report.qualityFailures).reduce((a, b) => a + b, 0);
  const fairPriceCents = roundHalfUp((rate * estimator.attributable) / verified);
  return {
    claimed: report.claimed,
    qualityFailures,
    qualityFailuresByReason: { ...report.qualityFailures },
    adjustmentCents: qualityFailures * rate,
    billedPerOutcomeCents: rate,
    fairPriceCents,
    incrementalityPct: R4_pct(estimator.attributable, verified),
    deltaPerOutcomeCents: rate - fairPriceCents,
  };
}
