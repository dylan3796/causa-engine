/**
 * Micro-engagement end-to-end: hand-written CSV exports → intake (with reject
 * accounting) → preflight (verifiability + grade ceiling) → settled statement.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEngagementConfig, type EngagementConfig } from "@/src/intake/engagement";
import { preflight } from "@/src/intake/preflight";
import { runStatement } from "@/src/statement";

function makeEngagement(withArms: boolean): { engagement: EngagementConfig; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "causa-intake-"));
  writeFileSync(
    join(dir, "runs.csv"),
    [
      "run_id,actor,started_at,cost_usd,ticket_id,claim_wf",
      "r1,agent-1,2026-06-01 08:00:00,0.10,t1,wf", // verifies
      "r2,agent-1,2026-06-01 09:00:00,0.10,t2,wf", // quality fails (reopen)
      "r3,agent-1,2026-06-01 10:00:00,0.10,,wf", // no join key → unjoinable
      "r4,agent-1,2026-06-02 10:00:00,0.05,t1,", // non-claiming step
      "r1,agent-1,2026-06-03 10:00:00,0.10,t9,wf", // duplicate id → reject
      "r5,agent-1,not-a-date,0.10,t5,wf", // bad timestamp → reject
      "r6,agent-1,2026-06-03 11:00:00,lots,t6,wf", // bad money → reject
    ].join("\n") + "\n"
  );
  const arm = (v: string) => (withArms ? v : "");
  writeFileSync(
    join(dir, "outcomes.csv"),
    [
      "source,entity_kind,entity_id,event_type,occurred_at,experiment_id,arm",
      `zendesk,ticket,t1,created,2026-06-01T07:00:00Z,hx,${arm("treated")}`,
      `zendesk,ticket,t2,created,2026-06-01T07:00:00Z,hx,${arm("treated")}`,
      "zendesk,ticket,t1,resolved,2026-06-01T12:00:00Z,,",
      "zendesk,ticket,t2,resolved,2026-06-01T12:00:00Z,,",
      "zendesk,ticket,t2,reopened,2026-06-02T12:00:00Z,,",
      `zendesk,ticket,c1,created,2026-06-01T07:00:00Z,hx,${arm("control")}`,
      `zendesk,ticket,c2,created,2026-06-01T07:00:00Z,hx,${arm("control")}`,
      "zendesk,ticket,c1,resolved,2026-06-02T12:00:00Z,,",
      "bad row that is ragged",
    ].join("\n") + "\n"
  );

  const engagement: EngagementConfig = {
    name: "micro",
    period: { start: "2026-06-01T00:00:00.000Z", end: "2026-07-01T00:00:00.000Z" },
    actors: [{ id: "agent-1", class: "agent", name: "Agent" }],
    activitySources: [
      {
        file: "runs.csv",
        format: "csv",
        source: { const: "log_upload" },
        map: {
          id: "run_id",
          actorId: "actor",
          startedAt: "started_at",
          costUsd: "cost_usd",
          fields: ["ticket_id"],
          claim: { workflowId: "claim_wf", claimedEventType: { const: "resolved" } },
        },
      },
    ],
    outcomeSources: [
      {
        file: "outcomes.csv",
        format: "csv",
        source: "source",
        map: {
          entityKind: "entity_kind",
          entityId: "entity_id",
          eventType: "event_type",
          occurredAt: "occurred_at",
          assignment: { experimentId: "experiment_id", arm: "arm" },
        },
      },
    ],
    contracts: [
      {
        id: "micro-contract",
        workflowId: "wf",
        event: { source: "zendesk", eventType: "resolved" },
        qualityBar: { kind: "noEventWithin", eventType: "reopened", days: 7 },
        counterfactual: { kind: "holdout", experimentId: "hx", treatedArm: "treated", controlArm: "control" },
        join: { entityKind: "ticket", extractorRuleSetId: "keys" },
        billing: { kind: "perOutcome", rateCents: 100 },
        windowDays: 30,
        actorIds: ["agent-1"],
        declaredEventTypes: ["created", "resolved", "reopened"],
      },
    ],
    extractRuleSets: [{ id: "keys", rules: [{ from: "field", field: "ticket_id", entityKind: "ticket" }] }],
    verdictRules: [
      {
        id: "catch-all",
        verdict: "RENEGOTIATE",
        priority: 1,
        when: { op: "exists", metric: "qualityPassPct" },
        impact: { kind: "renegotiationDelta" },
      },
    ],
    activitySourceLabels: { log_upload: "Log upload" },
  };
  return { engagement, dir };
}

describe("Tier-0 intake, end to end", () => {
  it("accounts for every row: read = produced + rejected, with reasons", () => {
    const { engagement, dir } = makeEngagement(true);
    const { report } = loadEngagementConfig(engagement, dir);
    expect(report.totals.rowsRead).toBe(report.totals.recordsProduced + report.totals.rejected);
    const runsFile = report.files.find((f) => f.file === "runs.csv")!;
    expect(runsFile.recordsProduced).toBe(4);
    const reasons = runsFile.rejects.map((r) => r.reason).join(" | ");
    expect(reasons).toMatch(/duplicate run id/);
    expect(reasons).toMatch(/unparseable timestamp/);
    expect(reasons).toMatch(/unparseable money/);
    const outcomesFile = report.files.find((f) => f.file === "outcomes.csv")!;
    expect(outcomesFile.rejects.map((r) => r.reason).join(" | ")).toMatch(/ragged_row/);
  });

  it("settles a statement from raw exports: funnel, dispute, and grade all real", () => {
    const { engagement, dir } = makeEngagement(true);
    const { inputs, config } = loadEngagementConfig(engagement, dir);
    const statement = runStatement(inputs, config);
    const wf = statement.workflows[0];
    expect(wf.claimed).toBe(3); // r1 verifies, r2 fails quality, r3 unjoinable
    expect(wf.verified).toBe(1);
    expect(wf.drop).toEqual({ didNotHappen: 0, failedQualityBar: 1, unjoinable: 1, duplicateClaim: 0 });
    expect(wf.estimator.grade).toBe("A"); // holdout arms came in through the CSV
    expect(wf.estimator.cells.control).toEqual({ n: 2, k: 1 });
  });

  it("preflight reports verifiability and the honest grade ceiling before settling", () => {
    const ready = makeEngagement(true);
    const readyLoad = loadEngagementConfig(ready.engagement, ready.dir);
    const readyPre = preflight(readyLoad.inputs, readyLoad.config);
    expect(readyPre.contracts[0].verifiable).toBe(true);
    expect(readyPre.contracts[0].gradeCeiling).toBe("A");
    expect(readyPre.contracts[0].joinableClaims).toBe(2);
    expect(readyPre.contracts[0].notes.join(" ")).toMatch(/1 of 3 claims carry no extractable join key/);

    // Same exports minus the recorded arms: the holdout can't run, and the
    // ceiling says so before anyone pays for anything.
    const bare = makeEngagement(false);
    const bareLoad = loadEngagementConfig(bare.engagement, bare.dir);
    const barePre = preflight(bareLoad.inputs, bareLoad.config);
    expect(barePre.contracts[0].gradeCeiling).toBe("D");
    expect(barePre.contracts[0].designs[0]).toMatchObject({ kind: "holdout", ready: false });
  });
});
