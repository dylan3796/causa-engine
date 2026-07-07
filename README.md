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
tests/               69 tests: per-estimator micro-cases, window boundaries,
                     funnel conservation, byte-determinism, golden acceptance,
                     source hygiene
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

## The engine is sealed

No clocks, no `Math.random`, no locale formatting, no LLM calls, no UI-framework imports — all test-enforced. Verdicts come from replayable, deterministic logic: a verdict you can't replay is a verdict you can't defend in a billing dispute. LLMs belong (later) in ingestion and interpretation only — never in the verdict path.

## Shipping numbers to the site

The compass repo commits a copy of `generated/meridian-ledger.json` (at `lib/generated/meridian-ledger.json`) and pins every published figure in its build-time assertion block. To change a number: change the workbook/fixtures here, `npm run reconcile`, copy the regenerated artifact into compass, and update the pins there deliberately. Never hand-edit either artifact — failing loudly is the product behaving.
