/**
 * Rounding-rule registry — the single source of truth for how the engine
 * rounds. Every rounded quantity goes through exactly one named rule, applied
 * once at the stated boundary. The published ledger only reconciles if these
 * rules (and their ordering, see R5) are followed:
 *
 *   R1  counterfactual counts   → integer, rounded once at the estimator boundary
 *   R2  unit costs              → cents, from integer-cent sums
 *   R3  monthly dollar impacts  → whole dollars
 *   R4  percents / 2-dp shares  → half-up
 *   R5  derived deltas consume ALREADY-ROUNDED operands. E.g. the support
 *       fair price rounds to $1.06 BEFORE the $0.44 delta is taken; using the
 *       unrounded fair price yields a $1,219 impact instead of the published
 *       $1,233. This ordering is pinned by a unit test.
 *
 * All money is integer cents until display. Everything here is deterministic.
 */

const EPS = 1e-9;

/** Half-up rounding for non-negative quantities. Domain: x ≥ -EPS. */
export function roundHalfUp(x: number): number {
  if (x < -EPS) {
    throw new Error(`roundHalfUp domain error: engine quantities are non-negative, got ${x}`);
  }
  return Math.floor(x + 0.5 + EPS);
}

/** R1 — counterfactual counts: integers, rounded once at the estimator boundary. */
export function R1_count(x: number): number {
  return roundHalfUp(x);
}

/** R2 — unit costs in cents from an integer-cent total over an integer denominator. */
export function R2_unitCents(totalCents: number, denom: number): number {
  if (denom <= 0) throw new Error(`R2 denominator must be positive, got ${denom}`);
  return roundHalfUp(totalCents / denom);
}

/** R3 — monthly dollar impacts, whole dollars. */
export function R3_dollars(x: number): number {
  return roundHalfUp(x);
}

/** R4 — percent, half-up to an integer. */
export function R4_pct(num: number, den: number): number {
  if (den <= 0) throw new Error(`R4 denominator must be positive, got ${den}`);
  return roundHalfUp((100 * num) / den);
}

/** R4 — share to two decimal places (0.62-style micro-bar widths). */
export function R4_share2(num: number, den: number): number {
  return R4_pct(num, den) / 100;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * The one settlement of a raw counterfactual estimate against a verified
 * count: round once (R1), never exceed verified, never attribute negatively.
 * Every estimator must go through this — the funnel invariant
 * claimed ≥ verified ≥ attributable is enforced by this exact shape.
 */
export function settleCounterfactual(
  verified: number,
  cfRaw: number
): { counterfactual: number; attributable: number } {
  const counterfactual = Math.min(verified, R1_count(Math.max(0, cfRaw)));
  return { counterfactual, attributable: clamp(verified - counterfactual, 0, verified) };
}

/** Cents → dollars for the published ledger (exact for cent-precision values). */
export function centsToDollars(cents: number): number {
  return cents / 100;
}
