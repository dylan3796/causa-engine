/**
 * Shared robustness arithmetic. Everything here is a falsification aid:
 * "how wrong would the measurement have to be for the conclusion to flip."
 * Deterministic, closed-form, and disclosed on the statement — never used
 * to move the integer ledger.
 */
import { roundHalfUp } from "../numeric";

/** Signed rounding to `dp` decimal places (roundHalfUp is non-negative only). */
export function signedRound(x: number, dp: number): number {
  const scale = 10 ** dp;
  const rounded = roundHalfUp(Math.abs(x) * scale) / scale;
  return x < 0 ? -rounded : rounded;
}

/**
 * Break-even sensitivity: attribution reaches zero exactly when the
 * counterfactual count reaches the verified count, i.e. when the measured
 * counterfactual is multiplied by verified/counterfactual. A factor of 4.3
 * reads: "the control-side rate would have to be 4.3× what we measured to
 * erase this delta." No finite factor exists when the measured
 * counterfactual is zero.
 */
export function breakEven(
  verified: number,
  counterfactualCount: number
): { factor: number | null; note: string } | undefined {
  if (verified <= 0) return undefined;
  if (counterfactualCount <= 0) {
    return {
      factor: null,
      note: "Measured counterfactual is zero; attribution erases only if every verified outcome would have happened anyway — no finite break-even factor.",
    };
  }
  const factor = signedRound(verified / counterfactualCount, 2);
  const note =
    factor <= 1
      ? `Estimate is at or below break-even already (counterfactual ${counterfactualCount} ≥ verified ${verified} would zero it at factor ${factor}).`
      : `The measured counterfactual (${counterfactualCount}) would have to be ${factor}× larger to erase the attributable delta.`;
  return { factor, note };
}
