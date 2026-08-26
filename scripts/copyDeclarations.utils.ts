// Build helper: tsc emits declarations only for .ts sources, so hand-written
// src/types/*.d.ts never reach dist/ and every emitted declaration dangles
// on "../types/*" imports (shipped broken through 0.10.0). Copy them verbatim.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const source = "src/types";
const target = "dist/types";
mkdirSync(target, { recursive: true });
for (const file of readdirSync(source)) {
  if (file.endsWith(".d.ts")) {
    cpSync(join(source, file), join(target, file));
  }
}
