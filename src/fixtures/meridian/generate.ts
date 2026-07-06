/**
 * Seeded expansion of the workbook cells into event-level records: ~14k
 * activity runs and ~16k outcome events for Meridian, June 2026.
 *
 * Randomness touches only non-load-bearing texture — timestamps within
 * windows, payload phrasing, cost jitter that re-normalizes to exact totals
 * (largest remainder). Every count, assignment, and window relationship is
 * driven directly by the solved cells in workbook.ts.
 */
import { distributeCents, randInt, substream } from "../../prng";
import { DAY_MS as DAY, HOUR_MS as HOUR, MIN_MS as MIN } from "../../time";
import type { Actor, ActivityRun, EngineInputs, OutcomeEvent } from "../../types";
import { CELLS } from "./workbook";

const T0 = Date.parse(CELLS.periodStart);
const MAY0 = T0 - 31 * DAY;

const iso = (ms: number) => new Date(ms).toISOString();

export const ACTORS: Actor[] = [
  { id: "support-agent", class: "agent", name: "Vendor support agent", vendor: "SupportCo" },
  { id: "workspace-agent", class: "agent", name: "In-house account agent" },
  { id: "notes-agent", class: "agent", name: "In-house notes agent" },
  { id: "sdr-agent", class: "agent", name: "Vendor SDR agent", vendor: "PipelineCo" },
  { id: "rep-1", class: "human", name: "Rep 1" },
  { id: "rep-2", class: "human", name: "Rep 2" },
  { id: "rep-3", class: "human", name: "Rep 3" },
];

interface Builders {
  runs: ActivityRun[];
  outcomes: OutcomeEvent[];
  run(r: Omit<ActivityRun, "id" | "endedAt"> & { endedAt?: string }): ActivityRun;
  event(e: Omit<OutcomeEvent, "id">): OutcomeEvent;
}

function makeBuilders(): Builders {
  const runs: ActivityRun[] = [];
  const outcomes: OutcomeEvent[] = [];
  let runSeq = 0;
  let evSeq = 0;
  return {
    runs,
    outcomes,
    run(r) {
      const full: ActivityRun = {
        id: `run-${String(++runSeq).padStart(5, "0")}`,
        endedAt: r.endedAt ?? iso(Date.parse(r.startedAt) + 5 * MIN),
        ...r,
      } as ActivityRun;
      runs.push(full);
      return full;
    },
    event(e) {
      const full: OutcomeEvent = { id: `ev-${String(++evSeq).padStart(5, "0")}`, ...e };
      outcomes.push(full);
      return full;
    },
  };
}

/* --------------------------------- support ----------------------------------- */

function generateSupport(b: Builders) {
  const c = CELLS.support;
  const rand = substream(CELLS.seed, "support");
  const costRand = substream(CELLS.seed, "support.costs");

  type Bucket = { model: string; kind: "verified" | "reopened" | "didNotHappen" | "unjoinable"; count: number };
  const buckets: Bucket[] = [];
  for (const [model, m] of Object.entries(c.byModel)) {
    buckets.push({ model, kind: "verified", count: m.verified });
    buckets.push({ model, kind: "reopened", count: m.reopened });
    buckets.push({ model, kind: "didNotHappen", count: m.didNotHappen });
    buckets.push({ model, kind: "unjoinable", count: m.unjoinable });
  }
  // Deterministic bucket order: verified first (late-reopen and refund
  // subsets index into the verified prefix).
  buckets.sort((a, b) => {
    const order = { verified: 0, reopened: 1, didNotHappen: 2, unjoinable: 3 } as const;
    return order[a.kind] - order[b.kind] || (a.model < b.model ? -1 : 1);
  });

  const verifiedCosts: Record<string, number[]> = {};
  for (const [model, m] of Object.entries(c.byModel)) {
    verifiedCosts[model] = distributeCents(m.verifiedCostCents, m.verified, costRand);
  }
  const verifiedCostIdx: Record<string, number> = {};

  const ticketEntity = (n: number) => ({ kind: "zendesk_ticket", id: String(40000 + n) });
  const controlEntity = (n: number) => ({ kind: "zendesk_ticket", id: String(90000 + n) });

  let ticketNo = 0;
  let verifiedIdx = 0;
  const verifiedTickets: Array<{ id: string; resolvedMs: number }> = [];

  for (const bucket of buckets) {
    for (let i = 0; i < bucket.count; i++) {
      const entity = ticketEntity(++ticketNo);
      const createdMs = T0 + randInt(rand, 0, 25) * DAY + randInt(rand, 0, 12) * HOUR;
      b.event({
        source: "zendesk",
        entity,
        eventType: "ticket_created",
        occurredAt: iso(createdMs),
        assignment: { experimentId: "support-holdout", arm: "treated" },
      });

      const runStartMs = createdMs + randInt(rand, 1, 8) * HOUR;
      const joinable = bucket.kind !== "unjoinable";
      const payload = !joinable
        ? {
            toolCalls: [{ name: "resolve_ticket", argsJson: JSON.stringify({ ticket: {} }) }],
            text: "Resolved a billing question; customer confirmed by email.",
          }
        : ticketNo % 5 < 3
          ? { toolCalls: [{ name: "resolve_ticket", argsJson: JSON.stringify({ ticket: { id: entity.id } }) }] }
          : { text: `Resolved https://meridian.zendesk.com/agent/tickets/${entity.id} after customer reply.` };

      let cost: number;
      if (bucket.kind === "verified") {
        const idx = verifiedCostIdx[bucket.model] ?? 0;
        verifiedCostIdx[bucket.model] = idx + 1;
        cost = verifiedCosts[bucket.model][idx];
      } else {
        cost = randInt(costRand, 80, 160);
      }

      b.run({
        source: "langsmith",
        actorId: "support-agent",
        model: bucket.model,
        startedAt: iso(runStartMs),
        costCents: cost,
        payload,
        claim: { workflowId: "support", claimedEventType: "ticket_resolved", claimedAt: iso(runStartMs) },
      });

      if (bucket.kind === "didNotHappen") continue;

      const resolvedMs = runStartMs + randInt(rand, 1, 20) * HOUR;
      b.event({ source: "zendesk", entity, eventType: "ticket_resolved", occurredAt: iso(resolvedMs) });

      if (bucket.kind === "reopened") {
        // Inside the 7-day bar: strictly < 168h after resolution.
        b.event({
          source: "zendesk",
          entity,
          eventType: "ticket_reopened",
          occurredAt: iso(resolvedMs + randInt(rand, 6, 160) * HOUR),
        });
      }
      if (bucket.kind === "verified") {
        verifiedIdx += 1;
        verifiedTickets.push({ id: entity.id, resolvedMs });
        if (verifiedIdx <= c.lateReopens) {
          // Outside the bar but inside the widened 30-day window: day 8–29.
          b.event({
            source: "zendesk",
            entity,
            eventType: "ticket_reopened",
            occurredAt: iso(resolvedMs + randInt(rand, 8 * 24, 29 * 24) * HOUR),
          });
        }
        if (verifiedIdx <= c.stripeRefunds) {
          // A refund traces back to the agent's ticket — no contract covers it.
          b.event({
            source: "stripe",
            entity,
            eventType: "refund_processed",
            occurredAt: iso(resolvedMs + randInt(rand, 24, 120) * HOUR),
          });
        }
      }
    }
  }

  // Treated tickets with no claim: human-resolved and untouched.
  for (let i = 0; i < c.humanResolvedTreated + c.untouchedTreated; i++) {
    const entity = ticketEntity(++ticketNo);
    const createdMs = T0 + randInt(rand, 0, 25) * DAY + randInt(rand, 0, 12) * HOUR;
    b.event({
      source: "zendesk",
      entity,
      eventType: "ticket_created",
      occurredAt: iso(createdMs),
      assignment: { experimentId: "support-holdout", arm: "treated" },
    });
    if (i < c.humanResolvedTreated) {
      b.event({
        source: "zendesk",
        entity,
        eventType: "ticket_resolved",
        occurredAt: iso(createdMs + randInt(rand, 24, 72) * HOUR),
      });
    }
  }

  // The holdout — the agent never touches these (the engine verifies that).
  for (let i = 1; i <= c.holdout; i++) {
    const entity = controlEntity(i);
    const createdMs = T0 + randInt(rand, 0, 25) * DAY + randInt(rand, 0, 12) * HOUR;
    b.event({
      source: "zendesk",
      entity,
      eventType: "ticket_created",
      occurredAt: iso(createdMs),
      assignment: { experimentId: "support-holdout", arm: "control" },
    });
    if (i <= c.controlResolved) {
      const resolvedMs = createdMs + randInt(rand, 24, 96) * HOUR;
      b.event({ source: "zendesk", entity, eventType: "ticket_resolved", occurredAt: iso(resolvedMs) });
      if (i <= c.controlReopened) {
        b.event({
          source: "zendesk",
          entity,
          eventType: "ticket_reopened",
          occurredAt: iso(resolvedMs + randInt(rand, 6, 160) * HOUR),
        });
      }
    }
  }

  // Non-claiming steps: trace noise that still carries keys (LangSmith) or
  // rides in via CSV export (log upload).
  for (let i = 0; i < c.langsmithSteps; i++) {
    const entity = ticketEntity(1 + (i % CELLS.support.treated));
    const startMs = T0 + randInt(rand, 0, 27) * DAY + randInt(rand, 0, 22) * HOUR;
    b.run({
      source: "langsmith",
      actorId: "support-agent",
      model: i % 2 === 0 ? "claude-fable-5" : "gpt-5",
      startedAt: iso(startMs),
      costCents: randInt(costRand, 2, 12),
      payload: { toolCalls: [{ name: "fetch_ticket", argsJson: JSON.stringify({ ticket: { id: entity.id } }) }] },
    });
  }
  for (let i = 0; i < c.logUploadSteps; i++) {
    const entity = ticketEntity(1 + (i % CELLS.support.treated));
    const startMs = T0 + randInt(rand, 0, 27) * DAY + randInt(rand, 0, 22) * HOUR;
    b.run({
      source: "log_upload",
      actorId: "support-agent",
      startedAt: iso(startMs),
      costCents: 0,
      payload: { fields: { ticket_id: entity.id, action: "triage" } },
    });
  }
}

/* -------------------------------- workspace ---------------------------------- */

function generateWorkspace(b: Builders) {
  const c = CELLS.workspace;
  const rand = substream(CELLS.seed, "workspace");
  const costs = distributeCents(c.totalRunCostCents, c.accounts + c.steps, substream(CELLS.seed, "workspace.costs"));
  let costIdx = 0;

  for (let i = 1; i <= c.accounts; i++) {
    const email = `emp${String(i).padStart(4, "0")}@meridian.com`;
    const entity = { kind: "servicenow_account", id: email };
    const runStartMs = T0 + randInt(rand, 0, 27) * DAY + randInt(rand, 8, 18) * HOUR;
    b.run({
      source: "langfuse",
      actorId: "workspace-agent",
      model: "claude-fable-5",
      startedAt: iso(runStartMs),
      costCents: costs[costIdx++],
      payload: { toolCalls: [{ name: "provision_account", argsJson: JSON.stringify({ employee: { email } }) }] },
      claim: { workflowId: "workspace", claimedEventType: "account_provisioned", claimedAt: iso(runStartMs) },
    });
    const provisionedMs = runStartMs + randInt(rand, 10, 50) * MIN;
    b.event({ source: "servicenow", entity, eventType: "account_provisioned", occurredAt: iso(provisionedMs) });
    // Quality bar: user active within 48 hours — every account passes.
    b.event({
      source: "servicenow",
      entity,
      eventType: "user_login",
      occurredAt: iso(provisionedMs + randInt(rand, 1, 47) * HOUR),
    });
  }

  for (let i = 0; i < c.steps; i++) {
    const email = `emp${String(1 + (i % c.accounts)).padStart(4, "0")}@meridian.com`;
    b.run({
      source: "langfuse",
      actorId: "workspace-agent",
      model: "claude-fable-5",
      startedAt: iso(T0 + randInt(rand, 0, 27) * DAY + randInt(rand, 0, 22) * HOUR),
      costCents: costs[costIdx++],
      payload: { toolCalls: [{ name: "check_directory", argsJson: JSON.stringify({ employee: { email } }) }] },
    });
  }
}

/* ---------------------------------- docgen ----------------------------------- */

function generateDocgen(b: Builders) {
  const c = CELLS.docgen;
  const rand = substream(CELLS.seed, "docgen");
  const costRand = substream(CELLS.seed, "docgen.costs");

  const models = Object.entries(c.byModel).sort(([a], [z]) => (a < z ? -1 : 1));
  const verifiedCosts = Object.fromEntries(
    models.map(([model, m]) => [model, distributeCents(m.verifiedCostCents, m.verified, costRand)])
  );
  const otherCount = models.reduce((acc, [, m]) => acc + (m.claims - m.verified), 0) + c.keylessRuns;
  const otherCosts = distributeCents(c.otherRunCostCents, otherCount, costRand);
  let otherIdx = 0;

  let issueNo = 999;
  for (const [model, m] of models) {
    for (let i = 0; i < m.claims; i++) {
      const key = `PROJ-${++issueNo}`;
      const entity = { kind: "jira_issue", id: key };
      const runStartMs = T0 + randInt(rand, 0, 27) * DAY + randInt(rand, 8, 18) * HOUR;
      const verified = i < m.verified;
      b.run({
        source: "langfuse",
        actorId: "notes-agent",
        model,
        startedAt: iso(runStartMs),
        costCents: verified ? verifiedCosts[model][i] : otherCosts[otherIdx++],
        payload:
          issueNo % 10 < 7
            ? { toolCalls: [{ name: "create_issue", argsJson: JSON.stringify({ issue: { key } }) }] }
            : { text: `Created ${key} from the weekly platform sync notes.` },
        claim: { workflowId: "docgen", claimedEventType: "issue_created", claimedAt: iso(runStartMs) },
      });
      const createdMs = runStartMs + randInt(rand, 5, 60) * MIN;
      b.event({ source: "jira", entity, eventType: "issue_created", occurredAt: iso(createdMs) });
      b.event({
        source: "jira",
        entity,
        eventType: verified ? "issue_accepted" : "issue_rejected",
        occurredAt: iso(createdMs + randInt(rand, 2, 40) * HOUR),
      });
    }
  }

  // Runs that never logged the issue key — the honest 39% of the join gap.
  for (let i = 0; i < c.keylessRuns; i++) {
    b.run({
      source: "langfuse",
      actorId: "notes-agent",
      model: "claude-fable-5",
      startedAt: iso(T0 + randInt(rand, 0, 27) * DAY + randInt(rand, 0, 22) * HOUR),
      costCents: otherCosts[otherIdx++],
      payload: { text: "Drafted meeting summary; ticket creation logged in the sidebar tool." },
    });
  }

  // Routing-gap control: meetings the agent never covered; a few got manual tickets.
  for (let i = 1; i <= c.routingControl.n; i++) {
    const entity = { kind: "docgen_meeting", id: `dm-${String(i).padStart(3, "0")}` };
    const loggedMs = T0 + randInt(rand, 0, 20) * DAY + randInt(rand, 8, 18) * HOUR;
    b.event({
      source: "jira",
      entity,
      eventType: "meeting_logged",
      occurredAt: iso(loggedMs),
      assignment: { experimentId: "docgen-routing", arm: "control" },
    });
    if (i <= c.routingControl.success) {
      const createdMs = loggedMs + randInt(rand, 24, 72) * HOUR;
      b.event({ source: "jira", entity, eventType: "issue_created", occurredAt: iso(createdMs) });
      b.event({
        source: "jira",
        entity,
        eventType: "issue_accepted",
        occurredAt: iso(createdMs + randInt(rand, 12, 40) * HOUR),
      });
    }
  }
}

/* --------------------------------- meetings ---------------------------------- */

function generateMeetings(b: Builders) {
  const c = CELLS.meetings;
  const rand = substream(CELLS.seed, "meetings");
  const costs = distributeCents(
    c.totalRunCostCents,
    c.assisted.claims + c.agentOnly.claims + c.extraAgentRuns + c.prepRuns,
    substream(CELLS.seed, "meetings.costs")
  );
  let costIdx = 0;

  const verifiedProspects: Array<{ id: string; oppMs: number }> = [];

  /** A prospect worked by the SDR agent in June (treated_post). */
  const treatedProspect = (
    experimentId: string,
    id: string,
    opts: { verified: boolean; humanTouches: number }
  ) => {
    const entity = { kind: "sf_prospect", id };
    const assignedMs = T0 + randInt(rand, 0, 4) * DAY + randInt(rand, 8, 18) * HOUR;
    b.event({
      source: "salesforce",
      entity,
      eventType: "prospect_assigned",
      occurredAt: iso(assignedMs),
      assignment: { experimentId, arm: "treated_post" },
    });
    const runStartMs = assignedMs + randInt(rand, 1, 48) * HOUR;
    b.run({
      source: "otel",
      actorId: "sdr-agent",
      startedAt: iso(runStartMs),
      costCents: costs[costIdx++],
      payload: { toolCalls: [{ name: "book_meeting", argsJson: JSON.stringify({ prospect: { id } }) }] },
      claim: { workflowId: "meetings", claimedEventType: "opportunity_created", claimedAt: iso(runStartMs) },
    });
    const bookedMs = runStartMs + 1 * HOUR;
    b.event({ source: "salesforce", entity, eventType: "meeting_booked", occurredAt: iso(bookedMs) });
    if (!opts.verified) return;

    b.event({
      source: "salesforce",
      entity,
      eventType: "meeting_held",
      occurredAt: iso(bookedMs + randInt(rand, 24, 48) * HOUR),
    });
    const oppMs = bookedMs + randInt(rand, 4, 12) * DAY;
    b.event({ source: "salesforce", entity, eventType: "opportunity_created", occurredAt: iso(oppMs) });
    b.event({
      source: "salesforce",
      entity,
      eventType: "opportunity_accepted",
      occurredAt: iso(oppMs + randInt(rand, 2, 20) * HOUR),
    });
    verifiedProspects.push({ id, oppMs });

    for (let t = 0; t < opts.humanTouches; t++) {
      // Rep touches land after booking and before the opportunity — inside
      // the 14-day contribution window. This is what makes the slice "assisted".
      b.run({
        source: "log_upload",
        actorId: `rep-${1 + ((verifiedProspects.length + t) % 3)}`,
        startedAt: iso(bookedMs + (t + 1) * DAY),
        costCents: 0,
        payload: { fields: { prospect_id: id, action: "call_logged" } },
      });
    }
  };

  // Assisted slice: every verified prospect carries rep touches per the
  // workbook plan (twoTouch×2 + oneTouch×1 — the 0.62/0.38 split's source).
  const touchPlan = c.assisted.humanTouchPlan;
  for (let i = 1; i <= c.assisted.claims; i++) {
    const verified = i <= c.assisted.verified;
    treatedProspect("meetings-assisted", `pa-${String(i).padStart(4, "0")}`, {
      verified,
      humanTouches: verified ? (i <= touchPlan.twoTouch ? 2 : 1) : 0,
    });
  }
  // Agent-only slice: 1,925 assigned, 232 worked, 154 verified, zero rep touches.
  for (let i = 1; i <= c.agentOnly.claims; i++) {
    treatedProspect("meetings-agentonly", `po-${String(i).padStart(4, "0")}`, {
      verified: i <= c.agentOnly.verified,
      humanTouches: 0,
    });
  }
  for (let i = c.agentOnly.claims + 1; i <= c.agentOnly.assignedPost; i++) {
    // Assigned to the agent pod but never worked — still part of the
    // treated-post denominator. That is what an honest 8% looks like.
    b.event({
      source: "salesforce",
      entity: { kind: "sf_prospect", id: `po-${String(i).padStart(4, "0")}` },
      eventType: "prospect_assigned",
      occurredAt: iso(T0 + randInt(rand, 0, 4) * DAY + randInt(rand, 8, 18) * HOUR),
      assignment: { experimentId: "meetings-agentonly", arm: "treated_post" },
    });
  }

  // Comparison cells — pre-period and control pods, reps only, no runs.
  const cellProspects = (experimentId: string, arm: string, prefix: string, n: number, k: number, baseMs: number) => {
    for (let i = 1; i <= n; i++) {
      const entity = { kind: "sf_prospect", id: `${prefix}-${String(i).padStart(4, "0")}` };
      const assignedMs = baseMs + randInt(rand, 0, 18) * DAY + randInt(rand, 8, 18) * HOUR;
      b.event({
        source: "salesforce",
        entity,
        eventType: "prospect_assigned",
        occurredAt: iso(assignedMs),
        assignment: { experimentId, arm },
      });
      if (i > k) continue;
      const bookedMs = assignedMs + randInt(rand, 1, 3) * DAY;
      b.event({ source: "salesforce", entity, eventType: "meeting_booked", occurredAt: iso(bookedMs) });
      b.event({ source: "salesforce", entity, eventType: "meeting_held", occurredAt: iso(bookedMs + randInt(rand, 24, 48) * HOUR) });
      const oppMs = bookedMs + randInt(rand, 3, 8) * DAY;
      b.event({ source: "salesforce", entity, eventType: "opportunity_created", occurredAt: iso(oppMs) });
      b.event({ source: "salesforce", entity, eventType: "opportunity_accepted", occurredAt: iso(oppMs + randInt(rand, 2, 20) * HOUR) });
    }
  };
  const a = c.assisted.cells;
  cellProspects("meetings-assisted", "treated_pre", "pmt", a.treatedPre.n, a.treatedPre.k, MAY0);
  cellProspects("meetings-assisted", "control_pre", "pmc", a.controlPre.n, a.controlPre.k, MAY0);
  cellProspects("meetings-assisted", "control_post", "pmq", a.controlPost.n, a.controlPost.k, T0);
  const o = c.agentOnly.cells;
  cellProspects("meetings-agentonly", "treated_pre", "pnt", o.treatedPre.n, o.treatedPre.k, MAY0);
  cellProspects("meetings-agentonly", "control_pre", "pnc", o.controlPre.n, o.controlPre.k, MAY0);
  cellProspects("meetings-agentonly", "control_post", "pnq", o.controlPost.n, o.controlPost.k, T0);

  // Extra agent runs on verified prospects: 314 claims + 182 extras = 496 touches.
  for (let i = 0; i < c.extraAgentRuns; i++) {
    const p = verifiedProspects[i % verifiedProspects.length];
    b.run({
      source: "otel",
      actorId: "sdr-agent",
      startedAt: iso(p.oppMs - randInt(rand, 12, 60) * HOUR),
      costCents: costs[costIdx++],
      payload: { toolCalls: [{ name: "book_meeting", argsJson: JSON.stringify({ prospect: { id: p.id } }) }] },
    });
  }
  // Prep/research runs that never log an entity — they don't join, honestly.
  for (let i = 0; i < c.prepRuns; i++) {
    b.run({
      source: "otel",
      actorId: "sdr-agent",
      startedAt: iso(T0 + randInt(rand, 0, 27) * DAY + randInt(rand, 0, 22) * HOUR),
      costCents: costs[costIdx++],
      payload: { text: "Researched account fit and drafted outreach sequence." },
    });
  }
}

/* ----------------------------------- entry ----------------------------------- */

let cached: EngineInputs | null = null;

export function generateMeridianInputs(): EngineInputs {
  if (cached) return cached;
  const b = makeBuilders();
  generateSupport(b);
  generateWorkspace(b);
  generateDocgen(b);
  generateMeetings(b);
  cached = {
    periodStart: CELLS.periodStart,
    periodEnd: CELLS.periodEnd,
    actors: ACTORS,
    runs: b.runs,
    outcomes: b.outcomes,
  };
  return cached;
}
