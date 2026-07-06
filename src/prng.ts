/**
 * Seeded PRNG for fixture generation. The engine itself never samples —
 * randomness exists only to give synthetic records non-load-bearing texture
 * (timestamps within windows, id suffixes, cost jitter that re-normalizes to
 * exact totals). Named substreams keep streams independent: adding a stream
 * never shifts another stream's draws.
 */
import { fnv1a32 } from "./hash";

export type Rand = () => number;

export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function substream(rootSeed: string, label: string): Rand {
  return mulberry32(fnv1a32(`${rootSeed}:${label}`));
}

/** Integer in [lo, hi], inclusive. */
export function randInt(rand: Rand, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

/**
 * Distribute an integer-cent total across n parts with jitter, summing
 * EXACTLY to the total (largest-remainder method; ties break by index).
 */
export function distributeCents(total: number, n: number, rand: Rand, spread = 0.35): number[] {
  if (n <= 0) return [];
  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < n; i++) {
    const w = 1 - spread + 2 * spread * rand();
    weights.push(w);
    weightSum += w;
  }
  const raw = weights.map((w) => (total * w) / weightSum);
  const floors = raw.map((x) => Math.floor(x));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const byFraction = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < byFraction.length && remainder > 0; k++, remainder--) {
    floors[byFraction[k].i] += 1;
  }
  return floors;
}
