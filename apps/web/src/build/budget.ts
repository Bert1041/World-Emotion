/**
 * Initial-JS budget (README §8.7): what the browser must download before first paint, gzipped.
 * Lazy chunks (dynamic `import()`, e.g. map data) are excluded on purpose; they load after.
 */
export const INITIAL_JS_BUDGET = 150_000;

/** Entry scripts and modulepreloads named by the built index.html, as dist-relative paths. */
export function entryScripts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g))
    out.push(stripRoot(m[1] as string));
  for (const m of html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g))
    out.push(stripRoot(m[1] as string));
  return out;
}

/**
 * Static imports of one chunk (`import … from "./x.js"`, `import "./x.js"`, `export … from`),
 * resolved against the chunk's directory. Dynamic `import("./x.js")` is not matched: no
 * parenthesis is allowed between the keyword and the specifier.
 */
export function staticImports(path: string, code: string): string[] {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  const out: string[] = [];
  for (const m of code.matchAll(
    /\b(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+)["']/g,
  ))
    out.push(resolve(dir, m[1] as string));
  return out;
}

/** Every chunk reachable from the entries through static imports (the initial download). */
export function initialChunks(html: string, read: (path: string) => string): string[] {
  const seen = new Set<string>();
  const queue = entryScripts(html);
  while (queue.length > 0) {
    const p = queue.pop() as string;
    if (seen.has(p)) continue;
    seen.add(p);
    queue.push(...staticImports(p, read(p)));
  }
  return [...seen].sort();
}

/**
 * Chunks that must never be in the initial download: loaded with `import()` only. Names are the
 * source file's basename, which Vite keeps as the chunk's prefix (`harness-<hash>.js`).
 */
export const LAZY_ONLY: readonly string[] = ["harness", "world-110m.topo", "world-50m.topo"];

/** The initial chunks that should have been lazy (empty when the split is intact). */
export function lazyLeaks(initial: readonly string[], lazyOnly = LAZY_ONLY): string[] {
  return initial.filter((c) => {
    const base = c.slice(c.lastIndexOf("/") + 1);
    return lazyOnly.some((name) => base === `${name}.js` || base.startsWith(`${name}-`));
  });
}

const stripRoot = (p: string) => p.replace(/^\.?\//, "");

function resolve(dir: string, spec: string): string {
  const parts = (dir + spec).split("/");
  const out: string[] = [];
  for (const s of parts) {
    if (s === "." || s === "") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return out.join("/");
}
