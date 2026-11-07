/**
 * CI gate: fail if the initial JS (gzipped) exceeds README §8.7's budget.
 * Usage: node scripts/budget.ts [distDir]   (run after `vite build`)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { INITIAL_JS_BUDGET, initialChunks } from "../src/build/budget.ts";

const dist = process.argv[2] ?? "dist";
const read = (p: string) => readFileSync(join(dist, p), "utf8");
const chunks = initialChunks(read("index.html"), read);
if (chunks.length === 0) throw new Error(`no entry script found in ${dist}/index.html`);

let total = 0;
for (const c of chunks) {
  const gz = gzipSync(readFileSync(join(dist, c)), { level: 9 }).length;
  total += gz;
  console.log(`${String(gz).padStart(8)} B gz  ${c}`);
}
const pct = ((total / INITIAL_JS_BUDGET) * 100).toFixed(0);
console.log(`initial JS ${total} B gzipped of ${INITIAL_JS_BUDGET} B budget (${pct}%)`);
if (total > INITIAL_JS_BUDGET) {
  console.error("over the initial-JS budget (README §8.7)");
  process.exit(1);
}
