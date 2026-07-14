/**
 * shapley-coalition-v1 — every expectation hand-derived from the Shapley
 * formula before the code ran. Two-player worlds keep the algebra checkable:
 * φ_A = ½·v({A}) + ½·(v({A,B}) − v({B})).
 */
import { describe, expect, it } from "vitest";
import { computeShapleyCredit } from "@/src/join/shapley";
import { runStatement, type EngineConfig } from "@/src/statement";
import type { ActivityRun, OutcomeEvent } from "@/src/types";
import { AGENT, HOUR, HUMAN, T0, TICKET_RULES, claimRun, ev, iso, makeContract, touchRun, world } from "./helpers";

/** agent-only / human-only / both coalitions with chosen conversion counts. */
function coalitionWorld(spec: { aOnly: [number, number]; bOnly?: [number, number]; both?: [number, number] }) {
  const contract = makeContract({});
  const runs: ActivityRun[] = [];
  const outcomes: OutcomeEvent[] = [];
  const fill = (prefix: string, actors: string[], [n, k]: [number, number]) => {
    for (let i = 1; i <= n; i++) {
      const id = `${prefix}${i}`;
      for (const actorId of actors) runs.push(touchRun(actorId, id, T0));
      if (i <= k) outcomes.push(ev(id, "resolved", T0 + HOUR));
    }
  };
  fill("a", [AGENT.id], spec.aOnly);
  if (spec.bOnly) fill("h", [HUMAN.id], spec.bOnly);
  if (spec.both) fill("b", [AGENT.id, HUMAN.id], spec.both);
  return world(contract, runs, outcomes).graph;
}

describe("shapley-coalition-v1", () => {
  it("two-player analytic case: v(A)=0.2, v(B)=0.4, v(AB)=0.8 → φ_A=0.3, φ_B=0.5", () => {
    const graph = coalitionWorld({ aOnly: [10, 2], bOnly: [10, 4], both: [10, 8] });
    const r = computeShapleyCredit(graph, 8)!;
    // Shares: 0.3/0.8 = 0.375 → 0.38; 0.5/0.8 = 0.625 → 0.63 (R4 half-up).
    expect(r.perActor).toEqual([
      { actorId: "agent-1", actorClass: "agent", share: 0.38, verifiedEquivalent: 3 },
      { actorId: "human-1", actorClass: "human", share: 0.63, verifiedEquivalent: 5 },
    ]);
    expect(r.agentShare).toBe(0.38);
    expect(r.humanShare).toBe(0.63);
    expect(r.coalitions).toEqual([
      { actors: ["agent-1"], n: 10, k: 2 },
      { actors: ["agent-1", "human-1"], n: 10, k: 8 },
      { actors: ["human-1"], n: 10, k: 4 },
    ]);
    expect(r.coverage).toEqual({ entities: 30, observedCoalitions: 3, closedCoalitions: 0 });
  });

  it("monotone closure: a joint rate BELOW agent-alone credits the second actor nothing", () => {
    // Observed: v({A}) = 0.6, v({A,B}) = 0.4 → closure lifts v({A,B}) to 0.6.
    // φ_A = 0.6, φ_B = 0 — adding B never looks like it destroyed outcomes.
    const graph = coalitionWorld({ aOnly: [10, 6], both: [10, 4] });
    const r = computeShapleyCredit(graph, 10)!;
    expect(r.perActor).toEqual([
      { actorId: "agent-1", actorClass: "agent", share: 1, verifiedEquivalent: 10 },
      { actorId: "human-1", actorClass: "human", share: 0, verifiedEquivalent: 0 },
    ]);
    expect(r.coverage.closedCoalitions).toBe(1); // {B} was never observed
  });

  it("largest-remainder apportionment: verified-equivalents are integers that sum to verified", () => {
    // Shares 0.375/0.625 × 7 verified = 2.625/4.375 → floors 2/4, remainder → agent.
    const graph = coalitionWorld({ aOnly: [10, 2], bOnly: [10, 4], both: [10, 8] });
    const r = computeShapleyCredit(graph, 7)!;
    expect(r.perActor.map((a) => a.verifiedEquivalent)).toEqual([3, 4]);
  });

  it("exact enumeration is capped: exceeding maxActors fails loudly, never silently samples", () => {
    const graph = coalitionWorld({ aOnly: [5, 1], bOnly: [5, 1] });
    expect(() => computeShapleyCredit(graph, 2, 1)).toThrow(/exact-enumeration cap/);
  });

  it("no touched entities → no report", () => {
    const contract = makeContract({});
    const graph = world(contract, [claimRun(null, T0)], []).graph;
    expect(computeShapleyCredit(graph, 0)).toBeUndefined();
  });

  it("statement wiring: contract.credit opts in; the default stays touch-count only", () => {
    const config = (credit: boolean): EngineConfig => ({
      contracts: [
        makeContract({
          billing: { kind: "flatMonthly", feeCents: 10000 },
          credit: credit ? { rule: "shapley-coalition-v1" } : undefined,
        }),
      ],
      extractRuleSets: [TICKET_RULES],
      verdictRules: [
        {
          id: "hold",
          verdict: "EXPAND",
          priority: 1,
          when: { op: "exists", metric: "qualityPassPct" },
          impact: { kind: "flatFeeRecovery" },
        },
      ],
      activitySourceLabels: { langsmith: "LangSmith", log_upload: "Log upload" },
      boundaryWindowDays: 30,
    });
    const inputs = {
      periodStart: iso(T0),
      periodEnd: iso(T0 + 30 * 24 * HOUR),
      actors: [AGENT, HUMAN],
      runs: [claimRun("t1", T0), touchRun(HUMAN.id, "t1", T0 + HOUR)],
      outcomes: [ev("t1", "resolved", T0 + 2 * HOUR)],
    };
    const withCredit = runStatement(inputs, config(true)).workflows[0];
    expect(withCredit.actorShapley?.method).toBe("shapley-coalition-v1");
    expect(withCredit.actorShapley!.perActor.map((a) => a.actorId)).toEqual(["agent-1", "human-1"]);
    const without = runStatement(inputs, config(false)).workflows[0];
    expect(without.actorShapley).toBeUndefined();
  });
});
