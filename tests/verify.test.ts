import { describe, expect, it } from "vitest";
import { DAY, HOUR, T0, claimRun, ev, makeContract, world } from "./helpers";

describe("verification stage", () => {
  it("quality windows are half-open: a reopen at exactly day 7 is OUTSIDE a 7-day bar", () => {
    const contract = makeContract();
    const resolvedAt = T0 + 24 * HOUR;
    const { report } = world(
      contract,
      [claimRun("t1", T0), claimRun("t2", T0)],
      [
        ev("t1", "resolved", resolvedAt),
        ev("t1", "reopened", resolvedAt + 7 * DAY), // boundary: passes
        ev("t2", "resolved", resolvedAt),
        ev("t2", "reopened", resolvedAt + 7 * DAY - 60_000), // inside: fails
      ]
    );
    expect(report.verified.map((v) => v.entityKey)).toEqual(["ticket:t1"]);
    expect(report.qualityFailures).toEqual({ reopened_within_7d: 1 });
  });

  it("eventWithin is half-open too: login at exactly 48h fails the 48-hour bar", () => {
    const contract = makeContract({
      event: { source: "servicenow", eventType: "provisioned" },
      qualityBar: { kind: "eventWithin", eventType: "login", hours: 48 },
      declaredEventTypes: ["provisioned", "login"],
    });
    const at = T0 + HOUR;
    const { report } = world(
      contract,
      [
        claimRun("a1", T0, { claim: { workflowId: "wf", claimedEventType: "provisioned", claimedAt: "2026-06-01T00:00:00.000Z" } }),
        claimRun("a2", T0, { claim: { workflowId: "wf", claimedEventType: "provisioned", claimedAt: "2026-06-01T00:00:00.000Z" } }),
      ],
      [
        ev("a1", "provisioned", at),
        ev("a1", "login", at + 48 * HOUR), // boundary: fails
        ev("a2", "provisioned", at),
        ev("a2", "login", at + 48 * HOUR - 60_000), // inside: passes
      ]
    );
    expect(report.verified.map((v) => v.entityKey)).toEqual(["ticket:a2"]);
    expect(report.qualityFailures).toEqual({ no_login_within_48h: 1 });
  });

  it("accounts for every claim: verified + didNotHappen + failedQualityBar + unjoinable = claimed", () => {
    const contract = makeContract();
    const { report } = world(
      contract,
      [
        claimRun("v1", T0), // verifies
        claimRun("d1", T0), // no resolved event
        claimRun("q1", T0), // reopens inside the bar
        claimRun(null, T0), // no key
      ],
      [
        ev("v1", "resolved", T0 + HOUR),
        ev("q1", "resolved", T0 + HOUR),
        ev("q1", "reopened", T0 + 2 * HOUR),
      ]
    );
    expect(report.claimed).toBe(4);
    expect(report.verified.length).toBe(1);
    expect(report.drop).toEqual({ didNotHappen: 1, failedQualityBar: 1, unjoinable: 1, duplicateClaim: 0 });
    expect(report.qualityPassPct).toBe(25);
  });

  it("the join window is half-open: an event at exactly windowDays does not verify", () => {
    const contract = makeContract({ windowDays: 2 });
    const { report } = world(
      contract,
      [claimRun("t1", T0), claimRun("t2", T0)],
      [
        ev("t1", "resolved", T0 + 2 * DAY), // boundary: outside
        ev("t2", "resolved", T0 + 2 * DAY - 60_000), // inside
      ]
    );
    expect(report.verified.map((v) => v.entityKey)).toEqual(["ticket:t2"]);
    expect(report.drop.didNotHappen).toBe(1);
  });

  it("a second claim on a settled outcome is a duplicate — a double-bill, not a miss", () => {
    const contract = makeContract();
    const { report } = world(
      contract,
      [claimRun("t1", T0), claimRun("t1", T0 + HOUR)],
      [ev("t1", "resolved", T0 + 2 * HOUR)]
    );
    expect(report.verified.length).toBe(1);
    expect(report.drop.duplicateClaim).toBe(1);
    expect(report.drop.didNotHappen).toBe(0);
  });

  it("a claim that missed its window does not block a later claim from verifying the outcome", () => {
    const contract = makeContract({ windowDays: 2 });
    const resolvedAt = T0 + 5 * DAY;
    const { report } = world(
      contract,
      [
        claimRun("t1", T0), // window [T0, T0+2d) misses the event
        claimRun("t1", resolvedAt - HOUR), // window covers it
      ],
      [ev("t1", "resolved", resolvedAt)]
    );
    expect(report.verified.length).toBe(1);
    expect(report.drop).toEqual({ didNotHappen: 1, failedQualityBar: 0, unjoinable: 0, duplicateClaim: 0 });
  });
});
