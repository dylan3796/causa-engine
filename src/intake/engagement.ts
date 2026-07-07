/**
 * Node shell over the pure intake core (build.ts): reads engagement configs
 * and export files from disk, then delegates. Everything reusable lives in
 * build.ts so the browser playground runs the identical intake path.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildEngagement, type EngagementConfig, type LoadedEngagement } from "./build";

export {
  buildEngagement,
  parseTable,
  renderIntakeReport,
} from "./build";
export type {
  ActivitySourceSpec,
  OutcomeSourceSpec,
  EngagementConfig,
  FileIntake,
  IntakeReport,
  LoadedEngagement,
  FileReader,
} from "./build";

export function loadEngagement(configPath: string): LoadedEngagement {
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as EngagementConfig;
  return loadEngagementConfig(raw, dirname(resolve(configPath)));
}

export function loadEngagementConfig(engagement: EngagementConfig, baseDir: string): LoadedEngagement {
  return buildEngagement(engagement, (file) => readFileSync(resolve(baseDir, file), "utf8"));
}
