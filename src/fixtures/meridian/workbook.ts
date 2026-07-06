/**
 * The Meridian workbook — solved integer cells FIRST, events second.
 *
 * Every published ledger figure is derived here analytically before a single
 * synthetic event exists, so exact reconciliation is engineered, not hoped
 * for. The generator expands these cells into event-level records; the
 * generate script asserts every PUBLISHED target back out of the real
 * pipeline; lib/data.ts pins the same numbers again at next build.
 *
 * Derivations (rounding rules from lib/engine/numeric.ts):
 *
 * SUPPORT (Grade A holdout, per-outcome billing at $1.50)
 *   eligible 3,913 = treated 3,523 + holdout 390 (390/3,913 = 9.97% ≈ "10%")
 *   claims 3,214 = verified 2,802 + didNotHappen 240 + reopened≤7d 61 + unjoinable 111
 *   control: 104 resolved, 14 reopened ≤7d → k_c = 90 quality-passing
 *   counterfactual = R1(90 × 3,523 / 390) = R1(813.0) = 813  → attributable 1,989
 *   incrementality = R4(1,989/2,802) = 71%
 *   spend = 3,214 × 150¢ = $4,821 ; $/verified = R2(482,100/2,802) = 172¢
 *   fair price = R1(150 × 1,989/2,802) = 106¢ ; delta = 150 − 106 = 44¢   (R5: round before delta)
 *   impact = R3(44¢ × 2,802 / 100) = $1,233 ; adjustment = 61 × 150¢ = $91.50
 *   models: verified 1,737 claude / 1,065 gpt-5 → shares 0.62/0.38
 *   marginals: 206,703¢/1,737 = 119¢ ; 139,515¢/1,065 = 131¢ (exact multiples)
 *   late reopens (day 8–29): 252 → R4(252/2,802) = 9%
 *   resolved events = 2,802 + 61 + 111 (unjoinable) + 136 (human-resolved) + 104 (control) = 3,214
 *
 * WORKSPACE (Grade C 12-month baseline, usage billing)
 *   486 claimed = verified = attributable (displacement basis)
 *   run costs Σ = 20,400¢ → $/verified = R2(20,400/486) = 42¢
 *   baseline: 9 of 12 months match volume ±25% of 486; lower-middle median = 1,190¢
 *   EXPAND impact = R3(200 × (1,112 − 42)¢/100) = $2,140
 *
 * DOCGEN (Grade B, usage billing)
 *   claims 640 = claude 544 + qwen 96 ; verified 601 = 511 + 90 ; rejected 39 = 33 + 6
 *   acceptance 511/544 = 93.9% vs 90/96 = 93.75% → parity (|Δ| ≤ 1pt), both display 94
 *   routing gap: control 15/310, projected onto 640 covered ATTEMPTS
 *     cf = R1(15/310 × 640) = R1(30.968) = 31 → attributable 570
 *   marginals: 158,410¢/511 = 310¢ ; 10,890¢/90 = 121¢ ; other-runs cost 29,100¢ → Σ 198,400¢
 *   REROUTE impact = R3((310 − 121)¢ × 570/100) = R3(1,077.3) = $1,077
 *   coverage: 640 keyed of 1,049 notes-agent runs → R4 = 61%
 *
 * MEETINGS (Grade B staged rollout DiD per slice, flat $2,900/mo)
 *   claims 472 = agent_only 232 + assisted 240 ; verified 314 = 154 + 160
 *   assisted cells: pre-T 32/200, pre-C 30/200, post-C 33/200 → expected 0.175
 *     cf = R1(0.175 × 240) = 42 → attributable 118
 *   agent_only cells: 44/400 in all three comparison arms (11%) ; treated-post 154/1,925 (8.0%)
 *     cf = R1(0.11 × 1,925) = R1(211.75) = 212 > 154 → clamped to 0, point delta −57.75 → RETIRE
 *   touches on verified: agent 496 (314 claims + 182 extra runs) / human 304 (144×2 + 16×1)
 *     → split R4(496/800) = 0.62 / 0.38
 *   $/verified = R2(290,000/314) = 924¢
 *
 * ACTIVITY SOURCES (Σ 14,203)
 *   LangSmith 8,912 = support claims 3,214 + support steps 5,698
 *   Langfuse 2,145 = workspace (486 + 610) + docgen (640 + 409)
 *   OpenTelemetry 1,659 = meetings claims 472 + extra 182 + prep 1,005
 *   Log upload 1,487 = support supplemental 1,183 + rep touch rows 304
 */

/** Golden targets — the published Meridian ledger, verbatim. */
export const PUBLISHED = {
  headers: {
    claimed: 4812,
    verified: 4203,
    attributable: 3163,
    spend: 9909,
    adjustmentIdentified: 91.5,
    projectedVerdictImpact: 7350,
  },
  workflows: {
    support: {
      claimed: 3214,
      verified: 2802,
      attributable: 1989,
      spend: 4821,
      costPerVerified: 1.72,
      grade: "A",
      verdict: "RENEGOTIATE",
      impactPerMonth: 1233,
      qualityPassPct: 87,
      deltaVsMay: -0.06,
      incrementalityPct: 71,
      modelSplit: [
        { model: "claude-fable-5", costPerVerified: 1.19, share: 0.62 },
        { model: "gpt-5", costPerVerified: 1.31, share: 0.38 },
      ],
    },
    workspace: {
      claimed: 486,
      verified: 486,
      attributable: 486,
      spend: 204,
      costPerVerified: 0.42,
      grade: "C",
      verdict: "EXPAND",
      impactPerMonth: 2140,
      qualityPassPct: 100,
      deltaVsMay: -0.01,
      incrementalityPct: 100,
    },
    docgen: {
      claimed: 640,
      verified: 601,
      attributable: 570,
      spend: 1984,
      costPerVerified: 3.3,
      grade: "B",
      verdict: "REROUTE",
      impactPerMonth: 1077,
      qualityPassPct: 94,
      deltaVsMay: 0.04,
      incrementalityPct: 95,
      modelSplit: [
        { model: "claude-fable-5", costPerVerified: 3.1, share: 0.85 },
        { model: "qwen-3", costPerVerified: 1.21, share: 0.15 },
      ],
    },
    meetings: {
      claimed: 472,
      verified: 314,
      attributable: 118,
      spend: 2900,
      costPerVerified: 9.24,
      grade: "B",
      verdict: "RETIRE",
      impactPerMonth: 2900,
      qualityPassPct: 67,
      deltaVsMay: 0.41,
      incrementalityPct: 38,
    },
  },
  dispute: {
    claimed: 3214,
    reopenedWithin7Days: 61,
    adjustment: 91.5,
    billedPerResolution: 1.5,
    fairPrice: 1.06,
    incrementalityPct: 71,
    renegotiationDeltaPerResolution: 0.44,
  },
  meetingsAttributionSplit: { agent: 0.62, human: 0.38 },
  connect: { runs: 14203, windowDays: 30, jiraJoinablePct: 61 },
  activityRuns: {
    LangSmith: 8912,
    Langfuse: 2145,
    OpenTelemetry: 1659,
    "Log upload": 1487,
  },
  discoveredFigures: { stripeRefunds: 44, lateReopenPct: 9, jiraRejections: 39 },
  benchmark: { yourCostPerResolvedTicket: 1.19 },
} as const;

/** Solved cells the generator expands into events. */
export const CELLS = {
  seed: "meridian-2026-06",
  periodStart: "2026-06-01T00:00:00.000Z",
  periodEnd: "2026-07-01T00:00:00.000Z",

  support: {
    rateCents: 150,
    treated: 3523,
    holdout: 390,
    controlResolved: 104,
    controlReopened: 14, // → k_c = 104 − 14 = 90
    byModel: {
      "claude-fable-5": { verified: 1737, reopened: 38, didNotHappen: 149, unjoinable: 69, verifiedCostCents: 206703 },
      "gpt-5": { verified: 1065, reopened: 23, didNotHappen: 91, unjoinable: 42, verifiedCostCents: 139515 },
    },
    humanResolvedTreated: 136, // treated tickets resolved with no agent claim
    untouchedTreated: 173, // 3,523 − 3,214 − 136
    lateReopens: 252, // day 8–29 reopens among verified
    stripeRefunds: 44, // refund events tracing to verified tickets
    langsmithSteps: 5698,
    logUploadSteps: 1183,
    priorCostPerVerifiedCents: [191, 186, 182, 178], // Feb–May
    /**
     * Corroborating Grade-C baseline (occurrence basis): pre-agent monthly
     * quality-passing resolution volumes. Median (lower-middle of all 12;
     * none match June's 2,802 volume, so the estimator falls back with the
     * assumption stated) = 815/mo — within 0.3% of the holdout's 813
     * counterfactual. Two independent designs, one conclusion.
     */
    preAgentMonths: [
      { month: "2025-01", volume: 795, costPerOutcomeCents: 610 },
      { month: "2025-02", volume: 842, costPerOutcomeCents: 605 },
      { month: "2025-03", volume: 760, costPerOutcomeCents: 640 },
      { month: "2025-04", volume: 828, costPerOutcomeCents: 618 },
      { month: "2025-05", volume: 815, costPerOutcomeCents: 652 },
      { month: "2025-06", volume: 790, costPerOutcomeCents: 600 },
      { month: "2025-07", volume: 866, costPerOutcomeCents: 633 },
      { month: "2025-08", volume: 820, costPerOutcomeCents: 625 },
      { month: "2025-09", volume: 805, costPerOutcomeCents: 645 },
      { month: "2025-10", volume: 851, costPerOutcomeCents: 612 },
      { month: "2025-11", volume: 778, costPerOutcomeCents: 660 },
      { month: "2025-12", volume: 833, costPerOutcomeCents: 628 },
    ],
  },

  workspace: {
    accounts: 486,
    steps: 610,
    totalRunCostCents: 20400,
    baselineMonths: [
      { month: "2025-01", volume: 512, costPerOutcomeCents: 1240 },
      { month: "2025-02", volume: 601, costPerOutcomeCents: 1195 },
      { month: "2025-03", volume: 350, costPerOutcomeCents: 1320 }, // volume out of ±25% — unmatched
      { month: "2025-04", volume: 445, costPerOutcomeCents: 1180 },
      { month: "2025-05", volume: 470, costPerOutcomeCents: 1210 },
      { month: "2025-06", volume: 520, costPerOutcomeCents: 1150 },
      { month: "2025-07", volume: 300, costPerOutcomeCents: 1420 }, // unmatched
      { month: "2025-08", volume: 480, costPerOutcomeCents: 1190 },
      { month: "2025-09", volume: 505, costPerOutcomeCents: 1165 },
      { month: "2025-10", volume: 490, costPerOutcomeCents: 1185 },
      { month: "2025-11", volume: 455, costPerOutcomeCents: 1230 },
      { month: "2025-12", volume: 220, costPerOutcomeCents: 1610 }, // unmatched
    ], // matched median (9 months, lower-middle) = 1,190¢ = $11.90
    expand: { adjacentVolume: 200, adjacentBaselineCostCents: 1112 },
    priorCostPerVerifiedCents: [47, 45, 44, 43],
  },

  docgen: {
    byModel: {
      "claude-fable-5": { claims: 544, verified: 511, verifiedCostCents: 158410 },
      "qwen-3": { claims: 96, verified: 90, verifiedCostCents: 10890 },
    },
    keylessRuns: 409, // runs missing the issue key → 640/1,049 = 61% joinable
    otherRunCostCents: 29100, // rejected-claim runs + keyless runs
    routingControl: { n: 310, success: 15 },
    priorCostPerVerifiedCents: [319, 321, 323, 326],
  },

  meetings: {
    feeCents: 290000,
    assisted: {
      claims: 240,
      verified: 160,
      cells: { treatedPre: { n: 200, k: 32 }, controlPre: { n: 200, k: 30 }, controlPost: { n: 200, k: 33 } },
      /** Rep touches on verified assisted prospects: 144×2 + 16×1 = 304 → split 496/(496+304) = 0.62. */
      humanTouchPlan: { twoTouch: 144, oneTouch: 16 },
    },
    agentOnly: {
      assignedPost: 1925,
      claims: 232,
      verified: 154,
      cells: { treatedPre: { n: 400, k: 44 }, controlPre: { n: 400, k: 44 }, controlPost: { n: 400, k: 44 } },
    },
    extraAgentRuns: 182, // second touches on verified prospects → 314 + 182 = 496
    prepRuns: 1005, // keyless research runs
    totalRunCostCents: 74800, // texture only; flat billing ignores it
    priorCostPerVerifiedCents: [810, 835, 860, 883],
  },
} as const;
