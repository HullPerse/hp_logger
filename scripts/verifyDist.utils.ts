// Release gate: every relative module specifier referenced from an emitted
// dist/**/*.d.ts must resolve to a real file, so a consumer compile with
// skipLibCheck:false cannot hit TS2307 (regression guard for the missing
// dist/types incident shipped through 0.10.0).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const collect = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? collect(path) : path.endsWith(".d.ts") ? [path] : [];
  });

const RELATIVE_SPECIFIER = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

const files = collect("dist");
let failures = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(RELATIVE_SPECIFIER)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    // Node16-style explicit `.js` specifiers map to TS sources.
    const base = specifier.replace(/\.[mc]?js$/, "");
    const resolved = normalize(join(dirname(file), base));
    const found = [
      resolved,
      `${resolved}.d.ts`,
      `${resolved}.ts`,
      join(resolved, "index.d.ts"),
      join(resolved, "index.js"),
    ].some((candidate) => existsSync(candidate));
    if (!found) {
      failures += 1;
      console.error(`dangling "${specifier}" in ${file}`);
    }
  }
}
if (failures > 0) {
  console.error(`verify:dist found ${failures} dangling relative declarations`);
  process.exit(1);
}
console.log(`verify:dist ok - ${files.length} declaration files checked`);
