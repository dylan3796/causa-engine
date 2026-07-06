# causa-engine

This is the Causa attribution core — the product. The landing page + demo live in `dylan3796/compass`; its `CAUSA.md` (vision & product doctrine) governs product decisions here too, especially §6 (architecture doctrine). Read it before changing engine behavior.

Rules that trip people up:

- **The engine is sealed and deterministic.** No `Date.now`, no argless `new Date()`, no `Math.random`, no `toLocaleString`, no LLM calls, no React/Next imports anywhere under `src/` — all test-enforced (`tests/hygiene.test.ts`). Verdicts come from replayable logic only; replay = (input hash, config hash, engine version).
- **Fixtures are workbook-first.** Every published Meridian figure is solved analytically in `src/fixtures/meridian/workbook.ts` BEFORE events exist; the seeded generator expands cells into records. To change a number: change the workbook cells, re-derive the arithmetic in the comments, and `npm run reconcile` — never tweak generated output or fudge an estimator.
- **Never hand-edit `generated/`.** Both artifacts are codegen output; `npm run reconcile` overwrites them and fails if any figure drifts from the published ledger.
- **Rounding goes through the registry** (`src/numeric.ts`, rules R1–R5) exactly once at the stated boundary. R5 ordering matters: derived deltas consume already-rounded operands (the $1.06 fair price rounds before the $0.44 delta).
- **Grades attach to designs, not formulas.** Estimator changes must keep the funnel invariant (claimed ≥ verified ≥ attributable, enforced via `settleCounterfactual`) and declare assumptions on the result — evidence attached, never implied.
- **Missing design data may downgrade (the evidence ceiling); integrity violations must throw.** A contaminated holdout fails the statement — it never quietly becomes a more generous estimate.
- The compass site consumes a committed copy of `generated/meridian-ledger.json` and re-pins every figure at its build; after changing numbers here, copy the artifact over and update compass's pins deliberately.

Commands: `npm run typecheck` · `npm test` (69 tests) · `npm run reconcile`.
