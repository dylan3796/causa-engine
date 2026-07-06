/**
 * The contribution graph: run → entity → outcome (CAUSA.md §6.2, the moat
 * surface). Nodes are runs, entities, and outcome events; edges are
 * run→entity (extracted keys) and outcome→entity (native). A "touch" is a
 * run→entity edge whose run precedes an outcome on that entity within the
 * contract window — the raw material for slices, credit, and coverage.
 */
import type { ExtractRuleSet } from "../extract/extractors";
import { extractEntities } from "../extract/extractors";
import type { Actor, ActivityRun, ActorClass, OutcomeContract, OutcomeEvent } from "../types";
import { EngineError, MissingDesignDataError, entityKey } from "../types";

export interface Touch {
  runId: string;
  actorId: string;
  actorClass: ActorClass;
  startedAtMs: number;
}

/**
 * Contract-independent indexes over the outcome records — built once per
 * statement and shared by every contract's graph.
 */
export interface OutcomeIndex {
  /** entity key → all outcome events on that entity, sorted by (occurredAt, id). */
  eventsByEntity: Map<string, OutcomeEvent[]>;
  /** experimentId → arm → distinct entity keys (recorded assignments; the engine never randomizes). */
  entityArms: Map<string, Map<string, Set<string>>>;
}

export function buildOutcomeIndex(outcomes: OutcomeEvent[]): OutcomeIndex {
  const eventsByEntity = new Map<string, OutcomeEvent[]>();
  for (const ev of outcomes) {
    const key = entityKey(ev.entity);
    let list = eventsByEntity.get(key);
    if (!list) eventsByEntity.set(key, (list = []));
    list.push(ev);
  }
  for (const list of eventsByEntity.values()) {
    list.sort((a, b) =>
      a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.id < b.id ? -1 : 1
    );
  }

  const entityArms = new Map<string, Map<string, Set<string>>>();
  for (const ev of outcomes) {
    if (!ev.assignment) continue;
    const { experimentId, arm } = ev.assignment;
    let arms = entityArms.get(experimentId);
    if (!arms) entityArms.set(experimentId, (arms = new Map()));
    let set = arms.get(arm);
    if (!set) arms.set(arm, (set = new Set()));
    set.add(entityKey(ev.entity));
  }

  return { eventsByEntity, entityArms };
}

export interface ContributionGraph {
  contract: OutcomeContract;
  /** Runs belonging to this workflow's actors (agent-class denominator for coverage). */
  workflowRuns: ActivityRun[];
  /** runId → entity keys of the contract's entity kind extracted from the payload. */
  entityKeysByRun: Map<string, string[]>;
  /** entity key → all outcome events on that entity, sorted by (occurredAt, id). */
  eventsByEntity: Map<string, OutcomeEvent[]>;
  /** entity key → touches (any actor class), sorted by (startedAt, runId). */
  touchesByEntity: Map<string, Touch[]>;
  /** experimentId → arm → distinct entity keys. */
  entityArms: Map<string, Map<string, Set<string>>>;
}

export function buildGraph(
  contract: OutcomeContract,
  runs: ActivityRun[],
  outcomeIndex: OutcomeIndex,
  ruleSet: ExtractRuleSet,
  actors: Actor[]
): ContributionGraph {
  const actorById = new Map(actors.map((a) => [a.id, a]));
  const workflowActorIds = new Set(contract.actorIds);

  const entityKeysByRun = new Map<string, string[]>();
  const touchesByEntity = new Map<string, Touch[]>();
  const workflowRuns: ActivityRun[] = [];

  for (const run of runs) {
    const actor = actorById.get(run.actorId);
    if (!actor) throw new EngineError("join", `run ${run.id} references unknown actor ${run.actorId}`);
    const isWorkflowRun = workflowActorIds.has(run.actorId);
    if (isWorkflowRun) workflowRuns.push(run);

    // Extraction is worth doing for any run that might touch this contract's
    // entities — workflow actors and outside actors alike (a rep's logged
    // touch on a prospect is how hybrid credit enters the graph).
    const keys = extractEntities(run, ruleSet)
      .filter((e) => e.kind === contract.join.entityKind)
      .map(entityKey);
    if (keys.length === 0) {
      if (isWorkflowRun) entityKeysByRun.set(run.id, []);
      continue;
    }
    entityKeysByRun.set(run.id, keys);

    const startedAtMs = Date.parse(run.startedAt);
    for (const key of keys) {
      let touches = touchesByEntity.get(key);
      if (!touches) touchesByEntity.set(key, (touches = []));
      touches.push({ runId: run.id, actorId: run.actorId, actorClass: actor.class, startedAtMs });
    }
  }
  for (const touches of touchesByEntity.values()) {
    touches.sort((a, b) => a.startedAtMs - b.startedAtMs || (a.runId < b.runId ? -1 : 1));
  }

  workflowRuns.sort((a, b) => (a.id < b.id ? -1 : 1));

  return {
    contract,
    workflowRuns,
    entityKeysByRun,
    eventsByEntity: outcomeIndex.eventsByEntity,
    touchesByEntity,
    entityArms: outcomeIndex.entityArms,
  };
}

/** Distinct entities recorded in an experiment arm. */
export function armEntities(graph: ContributionGraph, experimentId: string, arm: string): Set<string> {
  const set = graph.entityArms.get(experimentId)?.get(arm);
  if (!set) {
    throw new MissingDesignDataError(
      "estimate",
      `no recorded assignments for experiment ${experimentId} arm ${arm} — the design data is missing`
    );
  }
  return set;
}
