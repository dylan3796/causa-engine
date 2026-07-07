/**
 * Browser bundle entry — the engine that runs in the playground page.
 * Pure modules only: no node:fs, no node:path, no environment access.
 */
export { buildEngagement, parseTable, renderIntakeReport } from "./intake/build";
export type { EngagementConfig, ActivitySourceSpec, OutcomeSourceSpec, LoadedEngagement } from "./intake/build";
export { autoEngagement, detectFile, detectFormat } from "./intake/autodetect";
export { preflight, renderPreflight } from "./intake/preflight";
export { observe } from "./outcomes/observatory";
export {
  projectScale,
  projectObservedScale,
  mixOptions,
  substitutionTable,
  observedSubstitutionTable,
} from "./levers";
export { runStatement } from "./statement";
export { renderStatement } from "./report";
export { ENGINE_VERSION } from "./version";
// Deterministic sample datasets, generated client-side so the page stays light.
export { orgsweepFiles } from "../examples/orgsweep/generate";
export { northwindFiles } from "../examples/northwind/files";
