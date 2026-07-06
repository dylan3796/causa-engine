/**
 * Causa attribution core — public API.
 *
 * The sealed, deterministic causal core (CAUSA.md §6): the join engine
 * (run→entity→outcome contribution graph), the causal ladder (Grade A
 * holdout / B natural experiment / C pre-agent baseline / D rules), and the
 * replayable verdict engine. Zero UI, zero I/O, no clock, no randomness in
 * the engine path. Nothing under lib/engine may import React or Next.
 */
export { runStatement } from "./statement";
export type { EngineConfig } from "./statement";
export { renderStatement } from "./report";
export { ENGINE_VERSION } from "./version";
export * from "./types";
export type { ExtractRule, ExtractRuleSet } from "./extract/extractors";
export type { VerdictRule, ImpactFormula } from "./verdict/engine";
