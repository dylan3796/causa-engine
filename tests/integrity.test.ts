/**
 * Adversarial integrity checks: each gaming pattern is injected into a
 * micro-world and must be caught; the clean fixtures (Meridian, Northwind)
 * must NOT trip anything — the false-positive guard. Findings gate trust,
 * never arithmetic: the funnel stays identical either way.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runIntegrity } from "@/src/verify/integrity";
import { buildEngagement, type EngagementConfig } from "@/src/intake/build";
import { runStatement } from "@/src/statement";
import { runMeridian } from "@/src/fixtures/meridian";
import { northwindFiles } from "@/examples/northwind/files";
import type { Actor, ActivityRun, OutcomeEvent } from "@/src/types";
import { AGENT, DAY, HOUR, HUMAN, T0, claimRun, ev, iso, makeContract, world } from "./helpers";

function integrityOf(runs: ActivityRun[], outcomes: OutcomeEvent[], overrides = {}, actors?: Actor[]) {
  const contract = makeContract(overrides);
  const { graph, report } = world(contract, runs, outcomes, actors);
  return { report, integrity: runIntegrity(graph, report) };
}

describe("integrity checks catch the obvious plays", () => {
  it("duplicate-claim-rate: double-billing 5% of claims is a flag", () => {
    const runs: ActivityRun[] = [];
    const outcomes: OutcomeEvent[] = [];
    for (let i = 1; i <= 19; i++) {
      runs.push(claimRun(`t${i}`, T0));
      outcomes.push(ev(`t${i}`, "resolved", T0 + HOUR));
    }
    runs.push(claimRun("t1", T0 + 3 * HOUR)); // second bill on a settled entity
    const { report, integrity } = integrityOf(runs, outcomes);
    expect(report.drop.duplicateClaim).toBe(1);
    const f = integrity.findings.find((x) => x.check === "duplicate-claim-rate")!;
    expect(f.severity).toBe("flag");
    expect(f.observed).toBe(5);
    expect(f.samples).toContain("ticket:t1");
  });

  it("retroactive-claims: claims stamped days after the outcome they assert", () => {
    const runs: ActivityRun[] = [];
    const outcomes: OutcomeEvent[] = [];
    for (let i = 1; i <= 20; i++) {
      const retro = i === 1;
      runs.push(
        claimRun(`t${i}`, T0, retro
          ? { claim: { workflowId: "wf", claimedEventType: "resolved", claimedAt: iso(T0 + 3 * DAY) } }
          : {})
      );
      outcomes.push(ev(`t${i}`, "resolved", T0 + HOUR));
    }
    const { integrity } = integrityOf(runs, outcomes);
    const f = integrity.findings.find((x) => x.check === "retroactive-claims")!;
    expect(f.severity).toBe("flag");
    expect(f.observed).toBe(5);
    expect(f.detail).toMatch(/AFTER the outcome/);
  });

  it("claim-burst: one actor's 25-claim day against a 1-claim median", () => {
    const runs: ActivityRun[] = [];
    let n = 0;
    for (let d = 0; d < 10; d++) runs.push(claimRun(`u${++n}`, T0 + d * DAY));
    for (let i = 0; i < 25; i++) runs.push(claimRun(`u${++n}`, T0 + 10 * DAY + i * 60_000));
    const { integrity } = integrityOf(runs, []);
    const f = integrity.findings.find((x) => x.check === "claim-burst")!;
    expect(f.severity).toBe("warn");
    expect(f.observed).toBe(25); // 25 / median 1
    expect(f.samples).toEqual(["agent-1"]);
  });

  it("entity-splitting: TCK-77 and tck77 collapse under canonicalization", () => {
    const runs = [claimRun("TCK-77", T0), claimRun("tck77", T0 + HOUR)];
    const { report, integrity } = integrityOf(runs, [ev("TCK-77", "resolved", T0 + 2 * HOUR)]);
    expect(report.drop.duplicateClaim).toBe(0); // distinct entities — verification can't see the split
    const f = integrity.findings.find((x) => x.check === "entity-splitting")!;
    expect(f.observed).toBe(1);
    expect(f.samples[0]).toBe("ticket:TCK-77 ↔ ticket:tck77");
  });

  it("window-edge-concentration: outcomes piling up just inside the join window's far edge", () => {
    const runs: ActivityRun[] = [];
    const outcomes: OutcomeEvent[] = [];
    for (let i = 1; i <= 20; i++) {
      runs.push(claimRun(`t${i}`, T0));
      // 4 of 20 land at day 28 of a 30-day window (≥ 90% of the window).
      outcomes.push(ev(`t${i}`, "resolved", i <= 4 ? T0 + 28 * DAY : T0 + HOUR));
    }
    const { integrity } = integrityOf(runs, outcomes);
    const f = integrity.findings.find((x) => x.check === "window-edge-concentration")!;
    expect(f.severity).toBe("warn");
    expect(f.observed).toBe(20);
  });

  it("actor-verify-rate-outlier: an actor 50pts under the workflow rate is disclosed (info)", () => {
    const AGENT2: Actor = { id: "agent-2", class: "agent", name: "Agent 2" };
    const runs: ActivityRun[] = [];
    const outcomes: OutcomeEvent[] = [];
    for (let i = 1; i <= 20; i++) {
      runs.push(claimRun(`a${i}`, T0));
      outcomes.push(ev(`a${i}`, "resolved", T0 + HOUR));
    }
    for (let i = 1; i <= 20; i++) runs.push(claimRun(`b${i}`, T0, { actorId: AGENT2.id }));
    const { integrity } = integrityOf(
      runs,
      outcomes,
      { actorIds: [AGENT.id, AGENT2.id] },
      [AGENT, AGENT2, HUMAN]
    );
    const outliers = integrity.findings.filter((x) => x.check === "actor-verify-rate-outlier");
    expect(outliers).toHaveLength(2);
    expect(outliers.every((f) => f.severity === "info")).toBe(true);
    expect(outliers.every((f) => f.observed === 50)).toBe(true);
  });

  it("clean claim streams produce zero findings", () => {
    const runs: ActivityRun[] = [];
    const outcomes: OutcomeEvent[] = [];
    for (let i = 1; i <= 30; i++) {
      runs.push(claimRun(`t${i}`, T0 + (i % 10) * DAY));
      outcomes.push(ev(`t${i}`, "resolved", T0 + (i % 10) * DAY + HOUR));
    }
    const { integrity } = integrityOf(runs, outcomes);
    expect(integrity.findings).toEqual([]);
    expect(integrity.checksRun).toBe(6);
  });
});

describe("false-positive guard: the clean fixtures stay clean", () => {
  it("Meridian: no warn/flag findings on any workflow", () => {
    for (const w of runMeridian().workflows) {
      expect(w.integrity.findings.filter((f) => f.severity !== "info")).toEqual([]);
    }
  });

  it("Northwind through real intake: no warn/flag findings", () => {
    const engagement = JSON.parse(
      readFileSync(join(__dirname, "..", "examples", "northwind", "engagement.json"), "utf8")
    ) as EngagementConfig;
    const files = northwindFiles();
    const loaded = buildEngagement(engagement, (f) => files[f]);
    const statement = runStatement(loaded.inputs, loaded.config);
    for (const w of statement.workflows) {
      expect(w.integrity.findings.filter((f) => f.severity !== "info")).toEqual([]);
    }
  });
});
