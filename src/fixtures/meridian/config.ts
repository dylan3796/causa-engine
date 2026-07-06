/**
 * Meridian engine configuration — contracts, extraction rules, verdict rules.
 * All of it is serializable data; the engine's interpreters are the only code.
 */
import type { EngineConfig } from "../../statement";
import type { OutcomeContract } from "../../types";
import type { ExtractRuleSet } from "../../extract/extractors";
import type { VerdictRule } from "../../verdict/engine";
import { CELLS } from "./workbook";

export const EXTRACT_RULE_SETS: ExtractRuleSet[] = [
  {
    id: "support-keys",
    rules: [
      { from: "toolCallArg", tool: "resolve_ticket", argPath: "ticket.id", entityKind: "zendesk_ticket" },
      { from: "regex", on: "text", pattern: "zendesk\\.com/agent/tickets/(\\d+)", group: 1, entityKind: "zendesk_ticket" },
      { from: "field", field: "ticket_id", entityKind: "zendesk_ticket" },
    ],
  },
  {
    id: "workspace-keys",
    rules: [
      { from: "toolCallArg", tool: "provision_account", argPath: "employee.email", entityKind: "servicenow_account" },
      { from: "field", field: "employee_email", entityKind: "servicenow_account" },
    ],
  },
  {
    id: "docgen-keys",
    rules: [
      { from: "toolCallArg", tool: "create_issue", argPath: "issue.key", entityKind: "jira_issue" },
      { from: "regex", on: "text", pattern: "\\b(PROJ-\\d+)\\b", group: 1, entityKind: "jira_issue" },
    ],
  },
  {
    id: "meetings-keys",
    rules: [
      { from: "toolCallArg", tool: "book_meeting", argPath: "prospect.id", entityKind: "sf_prospect" },
      { from: "field", field: "prospect_id", entityKind: "sf_prospect" },
    ],
  },
];

export const CONTRACTS: OutcomeContract[] = [
  {
    id: "support-resolutions",
    workflowId: "support",
    event: { source: "zendesk", eventType: "ticket_resolved" },
    qualityBar: { kind: "noEventWithin", eventType: "ticket_reopened", days: 7 },
    counterfactual: {
      kind: "holdout",
      experimentId: "support-holdout",
      treatedArm: "treated",
      controlArm: "control",
    },
    // The baseline is always measured: the pre-agent history runs alongside
    // the holdout and corroborates it (815 expected/mo vs the holdout's 813).
    corroboration: [
      {
        kind: "preAgentBaseline",
        basis: "occurrence",
        months: [...CELLS.support.preAgentMonths],
        match: { volumeTolerancePct: 25, minMonths: 3 },
        seasonality: { comparisonMonth: "2025-06", maxDivergencePct: 15 },
      },
    ],
    join: { entityKind: "zendesk_ticket", extractorRuleSetId: "support-keys" },
    billing: { kind: "perOutcome", rateCents: CELLS.support.rateCents },
    windowDays: 30,
    actorIds: ["support-agent"],
    declaredEventTypes: ["ticket_created", "ticket_resolved", "ticket_reopened"],
  },
  {
    id: "workspace-accounts",
    workflowId: "workspace",
    event: { source: "servicenow", eventType: "account_provisioned" },
    qualityBar: { kind: "eventWithin", eventType: "user_login", hours: 48 },
    counterfactual: {
      kind: "preAgentBaseline",
      basis: "displacement",
      months: [...CELLS.workspace.baselineMonths],
      match: { volumeTolerancePct: 25, minMonths: 3 },
      seasonality: { comparisonMonth: "2025-06", maxDivergencePct: 15 },
    },
    join: { entityKind: "servicenow_account", extractorRuleSetId: "workspace-keys" },
    billing: { kind: "usage" },
    windowDays: 30,
    actorIds: ["workspace-agent"],
    declaredEventTypes: ["account_provisioned", "user_login"],
    expand: {
      adjacentVolume: CELLS.workspace.expand.adjacentVolume,
      adjacentBaselineCostCents: CELLS.workspace.expand.adjacentBaselineCostCents,
    },
  },
  {
    id: "docgen-issues",
    workflowId: "docgen",
    event: { source: "jira", eventType: "issue_created" },
    qualityBar: {
      kind: "all",
      of: [
        { kind: "requireEvent", eventType: "issue_accepted" },
        { kind: "noEventOfType", eventType: "issue_rejected" },
      ],
    },
    counterfactual: {
      kind: "naturalExperiment",
      form: "twoGroupRoutingGap",
      experimentId: "docgen-routing",
      controlArm: "control",
    },
    join: { entityKind: "jira_issue", extractorRuleSetId: "docgen-keys" },
    billing: { kind: "usage" },
    windowDays: 30,
    actorIds: ["notes-agent"],
    declaredEventTypes: ["meeting_logged", "issue_created", "issue_accepted", "issue_rejected"],
    modelSwitchCompanion: { incumbentModel: "claude-fable-5", altModel: "qwen-3" },
  },
  {
    id: "meetings-opportunities",
    workflowId: "meetings",
    event: { source: "salesforce", eventType: "opportunity_created" },
    qualityBar: {
      kind: "all",
      of: [
        { kind: "requireEvent", eventType: "meeting_held" },
        { kind: "requireEvent", eventType: "opportunity_accepted" },
      ],
    },
    counterfactual: {
      kind: "naturalExperiment",
      form: "didStagedRollout",
      slices: [
        {
          slice: "assisted",
          experimentId: "meetings-assisted",
          arms: { treatedPre: "treated_pre", controlPre: "control_pre", controlPost: "control_post", treatedPost: "treated_post" },
        },
        {
          slice: "agent_only",
          experimentId: "meetings-agentonly",
          arms: { treatedPre: "treated_pre", controlPre: "control_pre", controlPost: "control_post", treatedPost: "treated_post" },
        },
      ],
    },
    join: { entityKind: "sf_prospect", extractorRuleSetId: "meetings-keys" },
    billing: { kind: "flatMonthly", feeCents: CELLS.meetings.feeCents },
    windowDays: 14,
    actorIds: ["sdr-agent"],
    declaredEventTypes: [
      "prospect_assigned",
      "meeting_booked",
      "meeting_held",
      "opportunity_created",
      "opportunity_accepted",
    ],
  },
];

/**
 * The Meridian verdict rule set — ordered, first match wins. Five stamps
 * (doctrine §4.4); REPRICE is configured but no Meridian workflow triggers it.
 */
export const VERDICT_RULES: VerdictRule[] = [
  {
    id: "retire-non-incremental-slice",
    verdict: "RETIRE",
    priority: 1,
    when: {
      op: "and",
      of: [
        { op: "cmp", metric: "billingKind", cmp: "eq", value: "flatMonthly" },
        { op: "cmp", metric: "minSlicePointDelta", cmp: "lte", value: 0 },
      ],
    },
    impact: { kind: "flatFeeRecovery" },
  },
  {
    id: "renegotiate-price-gap",
    verdict: "RENEGOTIATE",
    priority: 2,
    when: {
      op: "and",
      of: [
        { op: "cmp", metric: "billingKind", cmp: "eq", value: "perOutcome" },
        { op: "cmp", metric: "priceDeltaCents", cmp: "gte", value: 5 },
      ],
    },
    impact: { kind: "renegotiationDelta" },
  },
  {
    id: "reroute-cheaper-engine",
    verdict: "REROUTE",
    priority: 3,
    when: {
      op: "and",
      of: [
        { op: "cmp", metric: "modelSwitchParity", cmp: "eq", value: true },
        { op: "cmp", metric: "modelSwitchSavingsCents", cmp: "gt", value: 0 },
      ],
    },
    impact: { kind: "rerouteDelta" },
  },
  {
    id: "expand-proven-cheap",
    verdict: "EXPAND",
    priority: 4,
    when: {
      op: "and",
      of: [
        { op: "cmp", metric: "qualityPassPct", cmp: "eq", value: 100 },
        { op: "cmp", metric: "expandConfigured", cmp: "eq", value: true },
        { op: "cmp", metric: "costVsBaselinePct", cmp: "lte", value: 25 },
      ],
    },
    impact: { kind: "expandProjection" },
  },
  {
    id: "reprice-to-market",
    verdict: "REPRICE",
    priority: 5,
    when: {
      op: "and",
      of: [
        { op: "cmp", metric: "billingKind", cmp: "eq", value: "perOutcome" },
        { op: "cmp", metric: "priceDeltaCents", cmp: "lt", value: 5 },
        { op: "cmp", metric: "incrementalityPct", cmp: "gte", value: 90 },
      ],
    },
    impact: { kind: "repriceDelta", targetRateCents: 99 },
  },
];

export const MERIDIAN_CONFIG: EngineConfig = {
  contracts: CONTRACTS,
  extractRuleSets: EXTRACT_RULE_SETS,
  verdictRules: VERDICT_RULES,
  activitySourceLabels: {
    langsmith: "LangSmith",
    langfuse: "Langfuse",
    otel: "OpenTelemetry",
    log_upload: "Log upload",
  },
  boundaryWindowDays: 30,
};
