/**
 * shapley-coalition-v1 — exact Shapley values over observed touching
 * coalitions. Opt-in per contract (OutcomeContract.credit); touch-count-v1
 * stays the default split.
 *
 * The game: players are the actors that touched any of the contract's
 * entities in the period. For each entity, its coalition is the set of
 * distinct actors that touched it; the coalition's value is the share of its
 * entities that satisfy the contract (event + quality bar — the same
 * deterministic check control arms go through, no claim anchor). Coalitions
 * nobody observed take the best observed subset's value (monotone closure),
 * which also keeps every marginal contribution non-negative. Enumeration is
 * exact over ≤ maxActors players — no sampling, byte-stable.
 *
 * What this is: a defensible division of credit for observed conversion
 * differences across actor combinations. What it is not: counterfactual
 * attribution — the coalition mix was not randomized, and the output says so.
 */
import { roundHalfUp } from "../numeric";
import type { ContributionGraph } from "./graph";
import { entitySatisfiesContract } from "../verify/verify";
import type { ActorClass, ShapleyCreditReport } from "../types";
import { EngineError } from "../types";

export const SHAPLEY_RULE_ID = "shapley-coalition-v1";
export const SHAPLEY_MAX_ACTORS_DEFAULT = 12;

export function computeShapleyCredit(
  graph: ContributionGraph,
  verified: number,
  maxActors = SHAPLEY_MAX_ACTORS_DEFAULT
): ShapleyCreditReport | undefined {
  // Universe: every entity with at least one recorded touch in the period.
  const classById = new Map<string, ActorClass>();
  const coalitionByEntity = new Map<string, string[]>();
  for (const [entKey, touches] of graph.touchesByEntity) {
    const ids = [...new Set(touches.map((t) => t.actorId))].sort((a, b) => (a < b ? -1 : 1));
    coalitionByEntity.set(entKey, ids);
    for (const t of touches) classById.set(t.actorId, t.actorClass);
  }
  if (coalitionByEntity.size === 0) return undefined;

  const actorIds = [...classById.keys()].sort((a, b) => (a < b ? -1 : 1));
  const m = actorIds.length;
  if (m > maxActors) {
    throw new EngineError(
      "credit",
      `shapley-coalition-v1 asked for ${m} actors but the exact-enumeration cap is ${maxActors} — raise credit.maxActors deliberately or fall back to touch-count-v1`
    );
  }
  const indexById = new Map(actorIds.map((id, i) => [id, i]));

  // Observed coalition cells.
  const cellByMask = new Map<number, { n: number; k: number }>();
  for (const [entKey, ids] of coalitionByEntity) {
    let mask = 0;
    for (const id of ids) mask |= 1 << indexById.get(id)!;
    let cell = cellByMask.get(mask);
    if (!cell) cellByMask.set(mask, (cell = { n: 0, k: 0 }));
    cell.n += 1;
    if (entitySatisfiesContract(graph, entKey)) cell.k += 1;
  }

  // Monotone closure over the subset lattice: v(S) = best observed T ⊆ S.
  const size = 1 << m;
  const v = new Float64Array(size);
  for (let mask = 1; mask < size; mask++) {
    const observed = cellByMask.get(mask);
    let best = observed ? observed.k / observed.n : 0;
    for (let i = 0; i < m; i++) {
      if (mask & (1 << i)) best = Math.max(best, v[mask & ~(1 << i)]);
    }
    v[mask] = best;
  }

  // Exact Shapley: φ_i = Σ_{S ∌ i} |S|!(m−|S|−1)!/m! · (v(S∪i) − v(S)).
  const factorial = (x: number) => {
    let acc = 1;
    for (let i = 2; i <= x; i++) acc *= i;
    return acc;
  };
  const weight: number[] = [];
  for (let s = 0; s < m; s++) weight[s] = (factorial(s) * factorial(m - 1 - s)) / factorial(m);
  const popcount = (x: number) => {
    let c = 0;
    while (x) {
      x &= x - 1;
      c += 1;
    }
    return c;
  };
  const phi = new Array<number>(m).fill(0);
  for (let mask = 0; mask < size; mask++) {
    const s = popcount(mask);
    for (let i = 0; i < m; i++) {
      if (mask & (1 << i)) continue;
      phi[i] += weight[s] * (v[mask | (1 << i)] - v[mask]);
    }
  }

  const total = phi.reduce((a, b) => a + b, 0);
  const exactShares = phi.map((x) => (total > 0 ? x / total : 0));

  // Largest-remainder apportionment of verified outcomes by exact share.
  const raw = exactShares.map((s) => s * verified);
  const floors = raw.map(Math.floor);
  let remaining = verified - floors.reduce((a, b) => a + b, 0);
  const order = actorIds
    .map((id, i) => ({ i, rem: raw[i] - floors[i], id }))
    .sort((a, b) => b.rem - a.rem || (a.id < b.id ? -1 : 1));
  const equivalents = [...floors];
  for (const { i } of order) {
    if (remaining <= 0) break;
    equivalents[i] += 1;
    remaining -= 1;
  }

  let agentPhi = 0;
  let humanPhi = 0;
  for (let i = 0; i < m; i++) {
    if (classById.get(actorIds[i]) === "agent") agentPhi += phi[i];
    else humanPhi += phi[i];
  }

  const coalitions = [...cellByMask.entries()]
    .map(([mask, cell]) => ({
      actors: actorIds.filter((_, i) => mask & (1 << i)),
      n: cell.n,
      k: cell.k,
    }))
    .sort((a, b) => (a.actors.join("|") < b.actors.join("|") ? -1 : 1));

  // R4 share, 2dp: same rule as touch-count-v1's shares.
  const share2 = (x: number) => roundHalfUp(x * 100) / 100;

  return {
    method: "shapley-coalition-v1",
    perActor: actorIds.map((id, i) => ({
      actorId: id,
      actorClass: classById.get(id)!,
      share: share2(exactShares[i]),
      verifiedEquivalent: equivalents[i],
    })),
    agentShare: total > 0 ? share2(agentPhi / total) : 0,
    humanShare: total > 0 ? share2(humanPhi / total) : 0,
    coalitions,
    coverage: {
      entities: coalitionByEntity.size,
      observedCoalitions: cellByMask.size,
      closedCoalitions: size - 1 - cellByMask.size,
    },
    assumptions: [
      "Coalition value = share of coalition-touched entities satisfying the contract (event + quality bar), no claim anchor.",
      "Unobserved coalitions take the best observed subset's value (monotone closure) — marginal contributions stay non-negative.",
      "Observational credit shares over recorded touches, not counterfactual attribution: the coalition mix was not randomized.",
    ],
  };
}
