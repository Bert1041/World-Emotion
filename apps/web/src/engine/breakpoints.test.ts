import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_QUERIES } from "./breakpoints";

const html = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");

describe("layout breakpoints have one definition", () => {
  it("every @media query in index.html is one of the exported strings, and each is used", () => {
    const inCss = [...html.matchAll(/@media\s+([^{]+?)\s*\{/g)].map((m) => (m[1] ?? "").trim());
    expect(inCss.length).toBeGreaterThan(0);
    for (const q of inCss)
      expect(ALL_QUERIES, `CSS query not in breakpoints.ts: ${q}`).toContain(q);
    for (const q of ALL_QUERIES) expect(inCss, `breakpoint unused in CSS: ${q}`).toContain(q);
  });
});
