import { writeFileSync } from "node:fs";
import path from "node:path";
import * as catalogue from "@shared/attendance/simulator/catalogue";

// Writes docs/plans/PHASE_2_SCENARIOS.md from the scenarios in the code.
// `shared/` has no package.json, so tsx loads it as CommonJS and Node sees the
// named exports only under `default`; take them from wherever they landed.
const render = (catalogue.renderCatalogue ?? (catalogue as unknown as { default: typeof catalogue }).default.renderCatalogue) as () => string;
const out = path.resolve(import.meta.dirname, "../../../docs/plans/PHASE_2_SCENARIOS.md");
writeFileSync(out, render());
process.stdout.write(`wrote ${out}\n`);
