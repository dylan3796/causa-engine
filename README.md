# causa-engine

**The attribution core.** Causa is the independent layer that settles what AI-agent workflows actually delivered — this repo is the sealed, deterministic engine that does the settling. The landing page + demo live in [`dylan3796/compass`](https://github.com/dylan3796/compass); that repo is the expression, this one is the substance.

Two engines compose (per `CAUSA.md` §6 in the compass repo):

- **The outcome engine** (extract → join → verify → interpret) identifies outcomes against confirmed contracts — and where no contract exists, it *interprets*: joined events nobody defined become candidate outcomes with a draft contract, provenance, and checkable sample entities. Not every outcome arrives clearly defined up front; the engine proposes, the customer confirms, and nothing settles money until confirmed.
- **The causal engine** (estimate → economics → verdict) does the causation work. A baseline is **always measured**: the primary counterfactual design settles the workflow, corroborating designs run alongside as attached evidence (never averaged in), and when the primary's data is missing the engine walks the ladder to the best design that can run — grade downgraded honestly, the fallback named. Integrity violations (a contaminated holdout) fail the statement loudly instead of degrading quietly.

## Layout

```
src/                 the engine: join (extract/, join/), verification (verify/),
                     interpretation (outcomes/), causal ladder (causal/ — Grade A
                     holdout, B natural experiment, C pre-agent baseline, D rules),
                     economics, verdict engine (verdict/), orchestrator (statement.ts),
                     evidence renderer (report.ts)
src/fixtures/meridian/  the Meridian synthetic dataset: solved workbook cells,
                     seeded event-level generator (~30k records), engine config
scripts/generate-ledger.ts  codegen: run the pipeline, assert every published
                     figure, write the artifacts
generated/           meridian-ledger.json (consumed by the compass site) and
                     meridian-statement.md (the human-readable settled statement)
tests/               116 tests: per-estimator micro-cases, window boundaries,
                     funnel conservation, byte-determinism, golden acceptance,
                     robustness (placebo, post-stratification, leave-one-out),
                     Shapley credit, adversarial integrity, source hygiene
```

## Commands

```bash
npm install
npm run typecheck
npm test             # the full suite
npm run reconcile    # run the pipeline over the Meridian fixtures, assert every
                     # published figure, regenerate generated/*
npm run preflight -- <engagement.json>   # what's verifiable with what's connected
npm run settle -- <engagement.json>      # intake → preflight → settled statement
npm run example      # export Meridian as customer-shaped files, settle via the CLI
```

## Tier-0 intake — two exports and a join key

A pilot needs no integration project (CAUSA.md §6.5). An **engagement** is one
JSON file: where the customer's exports live (CSV or NDJSON), how their columns
map onto canonical activity/outcome records (declarative `FieldSpec`s — data,
not code), the outcome contracts, and the verdict rules. Then:

- **Intake** maps every row or rejects it with a reason and row number —
  rows read = records produced + rejects, always (see `out/intake-report.md`).
- **Preflight** tells the customer what's verifiable with what they've
  connected and the evidence-grade ceiling it implies — per contract, per
  counterfactual design — before anything settles (`out/preflight.md`).
- **Settle** runs the two engines and writes the statement (`out/statement.md`
  + canonical `statement.json`).

`examples/meridian/engagement.json` is the working reference. The round-trip
acceptance test exports the entire Meridian fixture to runs.ndjson +
outcomes.csv, re-ingests it through this path, and requires the settled
statement to be **byte-identical** to the one computed directly from fixtures.

## Verifying results

- **`generated/meridian-statement.md`** — the settled statement, human-readable, regenerated on every reconcile. Every number with the cells it came from, every estimate with its design, assumptions, corroborating baselines, and 95% interval, every verdict with the rule and metric snapshot that produced it, plus the replay fingerprint (input hash · config hash · engine version) that makes the whole statement reproducible. This is the primary evidence surface.
- **`npm run reconcile`** — fails loudly if any engine-derived figure drifts from the published ledger by a single unit.
- **`npm test`** — includes the golden acceptance test (the engine must reproduce the published Meridian ledger exactly from event-level records) and the byte-determinism gate (two full pipeline runs must hash identically).

## Robustness, credit, and integrity — surviving hostile review

Three hardening layers ride on every statement. All deterministic, all disclosed as evidence; none of them ever moves the integer ledger.

**Robustness (`estimator.robustness`)** — falsification aids on every estimate:

- **Break-even sensitivity** (all grades): the factor the measured counterfactual would have to be multiplied by to erase the attributable delta — "the control rate would have to be 3.45× what we measured."
- **Post-stratification** (Grade A, opt-in via `stratifyBy`): per-stratum control rates weighted by the treated stratum mix — the categorical form of regression adjustment — plus the arm-balance table. Mix-imbalanced arms are disclosed, with the adjusted counterfactual as the fragility bound.
- **Placebo DiD** (Grade B, opt-in via `placebo` arms): the same DiD run over pre-pre → pre, where the true effect is zero. A moving placebo FAILS on the statement. The pre-period gap each slice nets out is always stated (parallel trends is untestable in a 2×2 — nobody has to take it on faith silently). A Wald interval on the summed counterfactual accompanies the estimate.
- **Leave-one-out** (Grade C): the attributable count (occurrence basis) or the baseline unit cost (displacement basis) recomputed with each matched month dropped — the estimate must not hinge on one month.

**Credit (`workflow.actorShapley`, opt-in via `contract.credit`)** — `shapley-coalition-v1`: exact Shapley values over observed touching coalitions, where a coalition's value is the share of its entities satisfying the contract. Unobserved coalitions take the best observed subset's value (monotone closure). Exact enumeration to 12 actors — never sampled; the cap fails loudly. Output is credit shares plus a largest-remainder apportionment of verified outcomes; the assumptions block says plainly this is observational credit, not counterfactual attribution. `touch-count-v1` remains the default split.

**Integrity (`workflow.integrity`)** — six adversarial checks run on every statement, because the moment money settles on verified counts, the counts become a target: duplicate-claim rate, retroactive claims (claim stamped ≥24h after the outcome it asserts), per-actor claim bursts, entity splitting (distinct ids collapsing under canonicalization), window-edge concentration (outcomes piling up just inside the join window), and per-actor verify-rate outliers. Findings gate **trust, never arithmetic**: the funnel and verdict compute exactly as before, and a warn/flag is a disclosed dispute trigger for a human — an automatic adjustment on a heuristic would be a fabricated number, the thing this engine exists to refuse. The clean fixtures are the false-positive guard: Meridian and Northwind must produce zero warn/flag findings, enforced by test.

## The statement viewer (`web/`) — a separate deployment

`web/index.html` is a self-contained, zero-dependency viewer that renders settled statements — the funnel, the evidence cells, the uncertainty intervals, the verdicts and their replayable metric snapshots, and the proposed outcomes. It is **generated from live engine output** by `npm run build:viewer`, which settles two example runs and injects them:

- **Meridian** — the reference fixture.
- **Northwind** — a fresh customer, generated to CSV and settled through the real Tier-0 intake path.

Deploy it as its **own Vercel project**, separate from the Causa landing site (which lives in `dylan3796/compass`): point a new Vercel project at this repo — `vercel.json` already sets the build command to `npm run build:viewer` and the output directory to `web/`, so it regenerates the page from the engine on every deploy and there is nothing else to configure. The viewer is the engine's evidence surface; it is never coupled to the marketing site.

## The engine is sealed

No clocks, no `Math.random`, no locale formatting, no LLM calls, no UI-framework imports — all test-enforced. Verdicts come from replayable, deterministic logic: a verdict you can't replay is a verdict you can't defend in a billing dispute. LLMs belong (later) in ingestion and interpretation only — never in the verdict path.

## Shipping numbers to the site

The compass repo commits a copy of `generated/meridian-ledger.json` (at `lib/generated/meridian-ledger.json`) and pins every published figure in its build-time assertion block. To change a number: change the workbook/fixtures here, `npm run reconcile`, copy the regenerated artifact into compass, and update the pins there deliberately. Never hand-edit either artifact — failing loudly is the product behaving.
