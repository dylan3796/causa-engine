/**
 * Closed-form uncertainty intervals. Reported as evidence on estimator
 * results; they never gate the ledger (the ledger is integer counts, the
 * interval is honesty about them).
 */

/** z for a two-sided 95% interval. */
export const Z95 = 1.959963985;

export interface Interval {
  lo: number;
  hi: number;
}

/** Wilson score interval for a binomial proportion. */
export function wilson(k: number, n: number, z = Z95): Interval {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

/**
 * Newcombe hybrid score interval for a difference of proportions p1 − p2,
 * built from the two Wilson intervals.
 */
export function newcombeDiff(k1: number, n1: number, k2: number, n2: number, z = Z95): Interval {
  const p1 = n1 > 0 ? k1 / n1 : 0;
  const p2 = n2 > 0 ? k2 / n2 : 0;
  const w1 = wilson(k1, n1, z);
  const w2 = wilson(k2, n2, z);
  const d = p1 - p2;
  return {
    lo: d - Math.sqrt((p1 - w1.lo) ** 2 + (w2.hi - p2) ** 2),
    hi: d + Math.sqrt((w1.hi - p1) ** 2 + (p2 - w2.lo) ** 2),
  };
}
