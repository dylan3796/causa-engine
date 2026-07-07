/**
 * Causa attribution core — public API.
 *
 * The sealed, deterministic causal core (CAUSA.md §6): the join engine
 * (run→entity→outcome contribution graph), the causal ladder (Grade A
 * holdout / B natural experiment / C pre-agent baseline / D rules), the
 * replayable verdict engine, and Tier-0 intake ("two exports and a join
 * key"). Zero UI, no clock, no randomness in the engine path; the only I/O
 * lives in intake and the CLI.
 */
export { runStatement } from "./statement";
export type { EngineConfig } from "./statement";
export { renderStatement } from "./report";
export { loadEngagement, loadEngagementConfig, renderIntakeReport } from "./intake/engagement";
export type { EngagementConfig, ActivitySourceSpec, OutcomeSourceSpec, IntakeReport } from "./intake/engagement";
export { preflight, renderPreflight } from "./intake/preflight";
export type { PreflightReport } from "./intake/preflight";
export { ENGINE_VERSION } from "./version";
export * from "./types";
export type { ExtractRule, ExtractRuleSet } from "./extract/extractors";
export type { VerdictRule, ImpactFormula } from "./verdict/engine";
