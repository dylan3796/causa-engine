/**
 * Node wrapper: write the Northwind exports to disk (see files.ts for the
 * pure generator and the scenario description).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { northwindFiles } from "./files";

export function writeNorthwind(dir: string): void {
  for (const [name, content] of Object.entries(northwindFiles())) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = new URL(".", import.meta.url).pathname;
  writeNorthwind(here);
  console.log(`wrote ${here}data/runs.csv and outcomes.csv`);
}
