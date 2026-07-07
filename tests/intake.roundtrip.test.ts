/**
 * The Tier-0 acceptance test: export the entire Meridian fixture as
 * customer-shaped files (runs.ndjson + outcomes.csv), load them back through
 * the REAL intake path, and settle. The resulting statement must be
 * BYTE-IDENTICAL to the statement computed directly from in-memory fixtures —
 * proving the export → CSV/NDJSON → intake round trip loses nothing.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { hashValue } from "@/src/hash";
import { loadEngagement } from "@/src/intake/engagement";
import { preflight } from "@/src/intake/preflight";
import { runStatement } from "@/src/statement";
import { runMeridian } from "@/src/fixtures/meridian";

describe("Meridian through Tier-0 intake", () => {
  it("round-trips losslessly: intake statement is byte-identical to the direct statement", async () => {
    await import("../scripts/export-meridian-example");
    const engagementPath = join(__dirname, "..", "examples", "meridian", "engagement.json");
    const { inputs, config, report } = loadEngagement(engagementPath);

    expect(report.totals.rejected).toBe(0);
    expect(report.totals.rowsRead).toBe(inputs.runs.length + inputs.outcomes.length);

    const viaIntake = runStatement(inputs, config);
    const direct = runMeridian();
    expect(hashValue(viaIntake)).toBe(hashValue(direct));
  });

  it("preflight on the exports: all four workflows verifiable at their design grades", async () => {
    await import("../scripts/export-meridian-example");
    const { inputs, config } = loadEngagement(join(__dirname, "..", "examples", "meridian", "engagement.json"));
    const pre = preflight(inputs, config);
    const byId = Object.fromEntries(pre.contracts.map((c) => [c.workflowId, c]));
    expect(byId.support).toMatchObject({ verifiable: true, gradeCeiling: "A" });
    expect(byId.workspace).toMatchObject({ verifiable: true, gradeCeiling: "C" });
    expect(byId.docgen).toMatchObject({ verifiable: true, gradeCeiling: "B", runKeyPct: 61 });
    expect(byId.meetings).toMatchObject({ verifiable: true, gradeCeiling: "B" });
  });
});
