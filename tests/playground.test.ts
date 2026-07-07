/**
 * The playground path, end to end: heterogeneous multi-agent exports with NO
 * contracts → auto-detection → triangulation → per-agent quantified output →
 * levers. This is the "many agents, no time to define outcomes" scenario.
 */
import { describe, expect, it } from "vitest";
import { autoEngagement, detectFile, detectFormat } from "@/src/intake/autodetect";
import { buildEngagement } from "@/src/intake/build";
import { observe } from "@/src/outcomes/observatory";
import {
  mixOptions,
  observedSubstitutionTable,
  projectObservedScale,
  projectScale,
  substitutionTable,
} from "@/src/levers";
import { orgsweepFiles } from "@/examples/orgsweep/generate";
import { runMeridian } from "@/src/fixtures/meridian";

function sweep() {
  const files = orgsweepFiles();
  const { engagement, detections } = autoEngagement(
    Object.entries(files).map(([name, content]) => ({ name, content }))
  );
  const loaded = buildEngagement(engagement, (f) => files[f]);
  return { detections, loaded, report: observe(loaded.inputs) };
}

describe("auto-detection", () => {
  it("detects format and classifies activity vs outcomes from column shape", () => {
    expect(detectFormat('{"a":1}\n')).toBe("ndjson");
    expect(detectFormat("a,b\n1,2\n")).toBe("csv");
    const files = orgsweepFiles();
    expect(detectFile("agent_traces.ndjson", files["agent_traces.ndjson"]).kind).toBe("activity");
    expect(detectFile("sdr_outreach_log.csv", files["sdr_outreach_log.csv"]).kind).toBe("activity");
    expect(detectFile("helpdesk.csv", files["helpdesk.csv"]).kind).toBe("outcome");
  });

  it("maps unfamiliar column vocabularies and declares every inference", () => {
    const files = orgsweepFiles();
    const sdr = detectFile("sdr_outreach_log.csv", files["sdr_outreach_log.csv"]);
    expect(sdr.notes.join(" ")).toMatch(/actor←agent_name/);
    expect(sdr.notes.join(" ")).toMatch(/prospect_ref/);
    const crm = detectFile("crm_events.csv", files["crm_events.csv"]);
    expect(crm.notes.join(" ")).toMatch(/entity←prospect_ref/);
  });
});

describe("observatory — triangulate, quantify, propose", () => {
  it("ingests every heterogeneous row (no contracts, no claims, zero rejects)", () => {
    const { loaded } = sweep();
    expect(loaded.report.totals.rejected).toBe(0);
    expect(loaded.inputs.runs.length).toBe(1700); // 900 + 300 + 500
    expect(loaded.inputs.outcomes.length).toBe(640 + 30 + 260 + 80 + 240);
  });

  it("triangulates the join keys across logs and outcome systems", () => {
    const { report } = sweep();
    const byField = Object.fromEntries(report.joinKeys.map((k) => [`${k.field}→${k.entityKind}`, k]));
    expect(byField["ticket_id→ticket"]).toMatchObject({ runsWithField: 780, runsMatchingEntities: 720, distinctEntities: 640 });
    expect(byField["doc_id→doc"]).toMatchObject({ runsWithField: 300, runsMatchingEntities: 300, matchPct: 100 });
    expect(byField["prospect_ref→prospect"]).toMatchObject({ runsWithField: 440, runsMatchingEntities: 260 });
  });

  it("quantifies each agent's observed output and its cost", () => {
    const { report } = sweep();
    const byActor = Object.fromEntries(report.agents.map((a) => [a.actorId, a]));

    const support = byActor["support-bot"];
    expect(support.spendCents).toBe(3600); // 900 × 4¢
    expect(support.outputs[0]).toMatchObject({ eventType: "resolved", count: 640, costPerOutcomeCents: 6 });
    expect(support.outputs[1]).toMatchObject({ eventType: "reopened", count: 30 });
    expect(support.unjoinedRuns).toBeGreaterThan(0); // keyless + unmatched tickets, honestly counted

    expect(byActor["kb-bot"].outputs[0]).toMatchObject({ eventType: "published", count: 240, costPerOutcomeCents: 3 });
    const sdr = byActor["sdr-bot"];
    expect(sdr.outputs[0]).toMatchObject({ eventType: "meeting_booked", count: 260, costPerOutcomeCents: 19 });
    expect(sdr.outputs[1]).toMatchObject({ eventType: "opportunity_created", count: 80 });
  });

  it("proposes draft contracts for every observed output stream", () => {
    const { report } = sweep();
    const draft = report.drafts.find((d) => d.actorId === "sdr-bot" && d.draft.eventType === "meeting_booked");
    expect(draft).toMatchObject({ volume: 260 });
    expect(draft!.draft.entityKind).toBe("prospect");
    expect(report.notes.join(" ")).toMatch(/not attribution/i);
  });
});

describe("levers", () => {
  it("scale: projects settled workflows at observed rates, assumptions declared", () => {
    const support = runMeridian().workflows.find((w) => w.workflowId === "support")!;
    const p = projectScale(support, 1000);
    expect(p.projectedVerified).toBe(872); // 1000 × 2802/3214
    expect(p.projectedAttributable).toBe(619); // 872 × 1989/2802
    expect(p.projectedSpendCents).toBe(150000); // $1.50/claim
    expect(p.assumptions.join(" ")).toMatch(/holdout/i);
  });

  it("mix: surfaces the measured segment shifts (models, slices)", () => {
    const s = runMeridian();
    const docgen = mixOptions(s.workflows.find((w) => w.workflowId === "docgen")!);
    expect(docgen[0].name).toMatch(/claude-fable-5.*qwen-3|qwen-3/);
    expect(docgen[0].impactPerMonthDollars).toBeGreaterThan(0);
    const meetings = mixOptions(s.workflows.find((w) => w.workflowId === "meetings")!);
    expect(meetings.map((o) => o.name).join(" ")).toMatch(/assisted/);
  });

  it("substitute: ranks by cost per attributable outcome with the verdicts' stances", () => {
    const rows = substitutionTable(runMeridian());
    expect(rows[0].name).toBe("workspace"); // 42¢ per attributable
    expect(rows[rows.length - 1].name).toBe("meetings"); // $24.58 per attributable
    expect(rows.find((r) => r.name === "meetings")!.stance).toMatch(/not beating doing nothing/);
  });

  it("observatory levers stay honest about observed vs attributed", () => {
    const { report } = sweep();
    const support = report.agents.find((a) => a.actorId === "support-bot")!;
    const p = projectObservedScale(support, 300);
    expect(p.projectedOutcomes).toBe(213); // 300 × 640/900
    expect(p.assumptions.join(" ")).toMatch(/no counterfactual yet/i);
    const table = observedSubstitutionTable(report);
    expect(table[0].name).toBe("kb-bot"); // cheapest observed output at 3¢
  });
});
