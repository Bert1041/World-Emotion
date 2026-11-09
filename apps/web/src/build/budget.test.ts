import { describe, expect, it } from "vitest";
import { entryScripts, initialChunks, staticImports } from "./budget";

describe("initial-JS budget walk", () => {
  const html = `<link rel="icon" href="x.svg" />
    <script type="module" crossorigin src="/assets/index-A.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-B.js">`;

  it("finds entry scripts and modulepreloads, not other links", () => {
    expect(entryScripts(html)).toEqual(["assets/index-A.js", "assets/vendor-B.js"]);
  });

  it("follows static imports but not dynamic import()", () => {
    const code = `import{a as b}from"./shared-C.js";import"./side-D.js";export{x}from"../assets/re-E.js";
      const m=()=>import("./world-50m.topo-F.js");`;
    expect(staticImports("assets/index-A.js", code)).toEqual([
      "assets/shared-C.js",
      "assets/side-D.js",
      "assets/re-E.js",
    ]);
  });

  it("walks the whole static graph once, excluding lazy chunks", () => {
    const files: Record<string, string> = {
      "assets/index-A.js": `import"./shared-C.js";import("./lazy-L.js")`,
      "assets/vendor-B.js": `import"./shared-C.js"`,
      "assets/shared-C.js": `import"./index-A.js"`, // cycle
      "assets/lazy-L.js": `import"./only-lazy-M.js"`,
    };
    const read = (p: string) => {
      const f = files[p];
      if (f === undefined) throw new Error(`unexpected read ${p}`);
      return f;
    };
    expect(initialChunks(html, read)).toEqual([
      "assets/index-A.js",
      "assets/shared-C.js",
      "assets/vendor-B.js",
    ]);
  });
});
