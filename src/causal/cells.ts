/**
 * Shared arm scoring: what "quality-passing entities in an experiment arm"
 * means, defined once so Grade A holdouts and Grade B natural experiments
 * can never silently disagree about it.
 */
import type { ContributionGraph } from "../join/graph";
import { armEntities } from "../join/graph";
import { entitySatisfiesContract } from "../verify/verify";

export interface ArmCell {
  entities: Set<string>;
  n: number;
  k: number;
}

export function armCell(graph: ContributionGraph, experimentId: string, arm: string): ArmCell {
  const entities = armEntities(graph, experimentId, arm);
  let k = 0;
  for (const entKey of entities) {
    if (entitySatisfiesContract(graph, entKey)) k += 1;
  }
  return { entities, n: entities.size, k };
}
