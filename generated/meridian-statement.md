# Settled statement

**4,812 claimed → 4,203 verified → 3,163 attributable** · spend $9,909.00 · adjustment identified $91.50 · projected verdict impact $7,350/mo

Replay: input `aff10b3d0f02b6bc` · config `a0606ac8c3a29913` · engine `0.1.0` — same inputs, same config, same engine ⇒ byte-identical statement.

## support

**Funnel:** 3,214 claimed → 2,802 verified → 1,989 attributable
**Drops:** 240 didn't happen · 61 failed the quality bar · 111 unjoinable · 0 duplicate claims
  - quality failure ticket_reopened_within_7d: 61
**Economics:** $4,821.00 spend · $1.72/verified · quality pass 87%
  - claude-fable-5: 1,737 verified (share 0.62) · marginal $1.19/verified
  - gpt-5: 1,065 verified (share 0.38) · marginal $1.31/verified

**Evidence (holdout, Grade A):**
- Design: holdout · Grade A
- Counterfactual: 813 of 2,802 verified would have happened anyway → 1,989 attributable (71.0% incremental)
- 95% interval on incrementality: 64.8%–76.3% (wilson-newcombe)
- Cell treated: 2,802 / 3,523
- Cell control: 90 / 390
- Assumption: Assignment recorded at unit level before the period; the engine reads arms, it does not randomize.
- Assumption: Exclusion verified: no agent-class touch exists on any control-arm entity.
- Note: Control quality-passing rate 90/390 projected onto 3523 treated units → 813 would have happened anyway.
- Corroborating baseline (preAgentBaseline, Grade C):
  - Design: preAgentBaseline · Grade C
  - Counterfactual: 815 of 2,802 verified would have happened anyway → 1,987 attributable (70.9% incremental)
  - Cell matchedMonths: 12 / 12
  - Assumption: Only 0 baseline months matched volume ±25%; all 12 months used instead.
  - Assumption: Seasonality guard: volume diverges 254.7% from 2025-06 (limit 15%).
  - Assumption: Occurrence basis: matched-median baseline volume would have occurred without the agent.
  - Note: Matched 12/12 baseline months (volume ±25% of 2802); median cost/outcome $6.25 under the old process.

**Dispute:** billed $1.50/outcome · fair price $1.06 at 71% incrementality · delta $0.44 · 61 quality failures → $91.50 adjustment

**Verdict:** RENEGOTIATE (rule `renegotiate-price-gap`) · projected impact $1,233/mo
  - inputs: billingKind=perOutcome · costPerVerifiedCents=172 · expandConfigured=false · fairPriceCents=106 · incrementalityPct=71 · minSlicePointDelta=1989 · priceDeltaCents=44 · qualityPassPct=87 · rateCents=150
**Coverage:** 4,286/10,095 runs carry a join key (42%) · 3,103/3,214 claims joined

## workspace

**Funnel:** 486 claimed → 486 verified → 486 attributable
**Drops:** 0 didn't happen · 0 failed the quality bar · 0 unjoinable · 0 duplicate claims
**Economics:** $204.00 spend · $0.42/verified · quality pass 100%

**Evidence (preAgentBaseline, Grade C):**
- Design: preAgentBaseline · Grade C
- Counterfactual: 0 of 486 verified would have happened anyway → 486 attributable (100.0% incremental)
- Cell matchedMonths: 9 / 12
- Assumption: Displacement basis: outcomes would occur under the pre-agent process at baseline cost; attribution counts work performed, value is cost displacement.
- Note: Matched 9/12 baseline months (volume ±25% of 486); median cost/outcome $11.90 under the old process.

**Verdict:** EXPAND (rule `expand-proven-cheap`) · projected impact $2,140/mo
  - inputs: baselineCostPerOutcomeCents=1190 · billingKind=usage · costPerVerifiedCents=42 · costVsBaselinePct=4 · expandConfigured=true · incrementalityPct=100 · minSlicePointDelta=486 · qualityPassPct=100
**Coverage:** 486/1,096 runs carry a join key (44%) · 486/486 claims joined

## docgen

**Funnel:** 640 claimed → 601 verified → 570 attributable
**Drops:** 0 didn't happen · 39 failed the quality bar · 0 unjoinable · 0 duplicate claims
  - quality failure missing_issue_accepted: 39
**Economics:** $1,984.00 spend · $3.30/verified · quality pass 94%
  - claude-fable-5: 511 verified (share 0.85) · marginal $3.10/verified
  - qwen-3: 90 verified (share 0.15) · marginal $1.21/verified

**Evidence (naturalExperiment, Grade B):**
- Design: naturalExperiment · Grade B
- Counterfactual: 31 of 601 verified would have happened anyway → 570 attributable (94.8% incremental)
- 95% interval on incrementality: 91.7%–96.8% (wilson-newcombe)
- Cell control: 15 / 310
- Cell treated: 601 / 640
- Assumption: The uncovered routing slice's outcome rate is the counterfactual rate for covered attempts.
- Assumption: Routing assignment recorded; not reserved in advance (hence Grade B, not A).
- Note: Uncovered slice produced 15/310; projected onto 640 covered attempts → 31 of 601 verified would have happened anyway.

**Verdict:** REROUTE (rule `reroute-cheaper-engine`) · projected impact $1,077/mo
  - inputs: billingKind=usage · costPerVerifiedCents=330 · expandConfigured=false · incrementalityPct=95 · minSlicePointDelta=570 · modelSwitchParity=true · modelSwitchSavingsCents=189 · qualityPassPct=94
**Coverage:** 640/1,049 runs carry a join key (61%) · 640/640 claims joined

## meetings

**Funnel:** 472 claimed → 314 verified → 118 attributable
**Drops:** 158 didn't happen · 0 failed the quality bar · 0 unjoinable · 0 duplicate claims
**Economics:** $2,900.00 spend · $9.24/verified · quality pass 67%
  - actor split (touch-count-v1): agent 0.62 (496 touches) / human 0.38 (304 touches)

**Evidence (naturalExperiment, Grade B):**
- Design: naturalExperiment · Grade B
- Counterfactual: 196 of 314 verified would have happened anyway → 118 attributable (37.6% incremental)
- Cell assisted.treatedPre: 32 / 200
- Cell assisted.controlPre: 30 / 200
- Cell assisted.controlPost: 33 / 200
- Cell assisted.treatedPost: 160 / 240
- Cell agent_only.treatedPre: 44 / 400
- Cell agent_only.controlPre: 44 / 400
- Cell agent_only.controlPost: 44 / 400
- Cell agent_only.treatedPost: 154 / 1,925
- Slice assisted: 160 verified, 42 expected anyway → 118 attributable (point delta +118.0)
- Slice agent_only: 154 verified, 154 expected anyway → 0 attributable (point delta -57.8)
- Assumption: Parallel trends: treated and control pods would have moved together absent the rollout.
- Assumption: Rollout timing recorded and independent of outcome propensity.
- Assumption: Negative slice estimates are clamped to zero attribution; the negative point delta is preserved as evidence.
- Note: assisted: 160 verified vs 42 expected anyway (point delta +118.0).
- Note: agent_only: 154 verified vs 154 expected anyway (point delta -57.8).

**Verdict:** RETIRE (rule `retire-non-incremental-slice`) · projected impact $2,900/mo
  - inputs: billingKind=flatMonthly · costPerVerifiedCents=924 · expandConfigured=false · incrementalityPct=38 · minSlicePointDelta=-57.75 · qualityPassPct=67
**Coverage:** 654/1,659 runs carry a join key (39%) · 472/472 claims joined

## Proposed outcomes (awaiting confirmation)

The outcome engine interprets what the systems of record show beyond the confirmed contracts. Proposals never settle money until confirmed.

### qualityBarBoundary: ticket_reopened (zendesk) · via support — 252 (9% of verified)
- 252 verified outcomes (9%) had a ticket_reopened land after day 7 but inside day 30 — just past the quality bar.
- Widening the bar to 30 days would count them as failures.
- Draft contract: event `ticket_resolved` in zendesk, joined on `zendesk_ticket`, quality bar {"kind":"noEventWithin","eventType":"ticket_reopened","days":30} — awaiting confirmation
- Samples: zendesk_ticket:40098, zendesk_ticket:40177, zendesk_ticket:40115, zendesk_ticket:40093, zendesk_ticket:40228
- Seen: 2026-06-10T17:00:00.000Z → 2026-07-24T21:00:00.000Z

### unpricedQualityFailures: missing_issue_accepted (jira) · via docgen — 39
- 39 claims failed the quality bar (missing_issue_accepted) and no billing line prices the failure.
- Counting these as a contracted outcome (or pricing the failure) would make the loss visible.
- Samples: jira_issue:PROJ-1536, jira_issue:PROJ-1514, jira_issue:PROJ-1530, jira_issue:PROJ-1527, jira_issue:PROJ-1519

### uncontractedOutcome: refund_processed (stripe) · via support — 44
- 44 refund_processed events in stripe occur on zendesk_ticket entities the support agent's runs touch. No outcome contract covers them.
- Confirming the draft contract would bring these outcomes onto the ledger.
- Draft contract: event `refund_processed` in stripe, joined on `zendesk_ticket`, quality bar to be defined — awaiting confirmation
- Samples: zendesk_ticket:40001, zendesk_ticket:40002, zendesk_ticket:40003, zendesk_ticket:40004, zendesk_ticket:40005
- Seen: 2026-06-08T05:00:00.000Z → 2026-06-30T13:00:00.000Z

## Activity ingested

- LangSmith: 8,912 runs
- Langfuse: 2,145 runs
- Log upload: 1,487 runs
- OpenTelemetry: 1,659 runs
- Total: 14,203 runs
