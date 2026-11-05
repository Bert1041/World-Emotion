/**
 * Generates the country → continent map and the TopoJSON globe files.
 *
 *   node scripts/build.ts           regenerate data/ and src/countries.generated.ts
 *   node scripts/build.ts --check   regenerate in memory; exit 1 if committed files differ
 *
 * Inputs are pinned and checksum-verified. Every editorial decision is a named constant below and
 * is documented in docs/geo-decisions.md; a data change that would alter one fails loudly here.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import { topology } from "topojson-server";

type Continent = "AF" | "AN" | "AS" | "EU" | "NA" | "OC" | "SA";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache");

const NE_VERSION = "v5.1.2";
const NE_SOURCES = {
  "110m": "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f",
  "50m": "3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb",
} as const;
const GEONAMES_SHA256 = "79f8f59ea01cbb40438bf1856dd6c2ff201f03f8fc72d0530b2646aaf603ef04";

/** TopoJSON quantisation per level of detail (measured; see docs/geo-decisions.md). */
const QUANTIZATION = { "110m": 1e4, "50m": 1e4 } as const;

// ------------------------------------------------------------------------------------------------
// Decisions (docs/geo-decisions.md). Changing any of these is a product decision, not a refactor.
// ------------------------------------------------------------------------------------------------

/** Codes GeoNames still lists but ISO has withdrawn. Cloudflare will not report them. */
const RETIRED = new Set(["AN", "CS"]);

/** G1: Natural Earth calls these "Seven seas (open ocean)"; they take GeoNames' continent. */
const EXPECTED_SEVEN_SEAS = ["GS", "HM", "IO", "MU", "MV", "SC", "SH", "TF"];

/** G2: editorial calls where Natural Earth and GeoNames disagree. */
const EDITORIAL: Readonly<Record<string, Continent>> = { CY: "EU", TL: "AS" };

/** G3(a): ISO codes with no Natural Earth shape. Own entry, GeoNames continent, drawn as a marker. */
const EXPECTED_SHAPELESS = [
  "BQ",
  "BV",
  "CC",
  "CX",
  "GF",
  "GI",
  "GP",
  "MQ",
  "RE",
  "SJ",
  "TK",
  "UM",
  "YT",
];

/** G4: shapes with no ISO code. Drawn neutral and unselectable (no `id` in the TopoJSON). */
const EXPECTED_UNCODED_50M = ["CYN", "KAS", "SOL"]; // N. Cyprus, Siachen Glacier, Somaliland

const NE_CONTINENT: Readonly<Record<string, Continent | "SEVEN_SEAS">> = {
  Africa: "AF",
  Antarctica: "AN",
  Asia: "AS",
  Europe: "EU",
  "North America": "NA",
  Oceania: "OC",
  "South America": "SA",
  "Seven seas (open ocean)": "SEVEN_SEAS",
};

// ------------------------------------------------------------------------------------------------

interface NeProps {
  ISO_A2_EH: string;
  ADM0_A3: string;
  CONTINENT: string;
}

const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

function fail(msg: string): never {
  console.error(`geo-data build: ${msg}`);
  process.exit(1);
}

function sameSet(actual: Iterable<string>, expected: readonly string[], what: string) {
  const a = [...new Set(actual)].sort();
  const e = [...expected].sort();
  if (a.join() !== e.join())
    fail(`${what} changed.\n  expected ${e.join(",")}\n  got      ${a.join(",")}`);
}

async function fetchPinned(url: string, expected: string, cacheName: string): Promise<Buffer> {
  const path = join(CACHE, cacheName);
  if (existsSync(path)) {
    const cached = await readFile(path);
    if (sha256(cached) === expected) return cached;
  }
  const res = await fetch(url);
  if (!res.ok) fail(`download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== expected)
    fail(`checksum mismatch for ${url}\n  expected ${expected}\n  got      ${sha256(buf)}`);
  await mkdir(CACHE, { recursive: true });
  await writeFile(path, buf);
  return buf;
}

function parseGeonames(text: string): Map<string, Continent> {
  const out = new Map<string, Continent>();
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const f = line.split("\t");
    const code = f[0];
    const continent = f[8] as Continent;
    if (code === undefined || !/^[A-Z]{2}$/.test(code)) fail(`bad GeoNames code: ${line}`);
    if (!Object.values(NE_CONTINENT).includes(continent)) fail(`bad GeoNames continent: ${line}`);
    if (!RETIRED.has(code)) out.set(code, continent);
  }
  return out;
}

/** Merge every polygon of features sharing a code into one geometry (fixes NE's duplicate AU). */
function mergeGeometries(geoms: Geometry[]): Polygon | MultiPolygon {
  const polygons: Position[][][] = [];
  for (const g of geoms) {
    if (g.type === "Polygon") polygons.push(g.coordinates);
    else if (g.type === "MultiPolygon") polygons.push(...g.coordinates);
    else fail(`unexpected geometry type ${g.type}`);
  }
  const [only] = polygons;
  return polygons.length === 1 && only
    ? { type: "Polygon", coordinates: only }
    : { type: "MultiPolygon", coordinates: polygons };
}

interface CountryEntry {
  continent: Continent;
  shape: boolean;
}

async function main() {
  const check = process.argv.includes("--check");

  const geonamesText = await readFile(join(ROOT, "vendor/geonames-countryInfo.txt"), "utf8");
  if (sha256(geonamesText) !== GEONAMES_SHA256)
    fail("vendored GeoNames file changed; re-review and update its checksum");
  const geonames = parseGeonames(geonamesText);

  const ne: Record<string, FeatureCollection<Geometry, NeProps>> = {};
  for (const [res, hash] of Object.entries(NE_SOURCES)) {
    const url = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_VERSION}/geojson/ne_${res}_admin_0_countries.geojson`;
    ne[res] = JSON.parse(
      (await fetchPinned(url, hash, `ne_${res}_${NE_VERSION}.geojson`)).toString("utf8"),
    );
  }
  const ne50 = ne["50m"];
  if (ne50 === undefined) fail("missing 50m data");

  // ---- Country → continent map (the 50m set is the reference) ---------------------------------
  const shapes = new Map<string, Feature<Geometry, NeProps>[]>();
  const uncoded: string[] = [];
  for (const f of ne50.features) {
    const code = f.properties.ISO_A2_EH;
    if (code === "-99") uncoded.push(f.properties.ADM0_A3);
    else shapes.set(code, [...(shapes.get(code) ?? []), f]);
  }
  sameSet(uncoded, EXPECTED_UNCODED_50M, "Uncoded 50m shapes (G4)");

  const countries = new Map<string, CountryEntry>();
  const sevenSeas: string[] = [];
  for (const [code, fs] of shapes) {
    const gn = geonames.get(code);
    if (gn === undefined) fail(`Natural Earth code ${code} is not in GeoNames`);
    const neContinents = new Set(
      fs.map(
        (f) =>
          NE_CONTINENT[f.properties.CONTINENT] ??
          fail(`unknown NE continent ${f.properties.CONTINENT}`),
      ),
    );
    let continent: Continent;
    if (neContinents.size > 1) {
      // Several shapes disagree (e.g. AU's Indian Ocean territories): take GeoNames, which must be one of them.
      if (!neContinents.has(gn))
        fail(`${code}: GeoNames ${gn} not among NE ${[...neContinents].join("/")}`);
      continent = gn;
    } else {
      const [only] = neContinents;
      if (only === "SEVEN_SEAS") {
        sevenSeas.push(code);
        continent = gn; // G1
      } else continent = only ?? fail(`${code}: no continent`);
    }
    countries.set(code, { continent: EDITORIAL[code] ?? continent, shape: true }); // G2
  }
  sameSet(sevenSeas, EXPECTED_SEVEN_SEAS, "Seven-seas codes (G1)");

  const shapeless = [...geonames.keys()].filter((c) => !countries.has(c));
  sameSet(shapeless, EXPECTED_SHAPELESS, "Shapeless ISO codes (G3)");
  for (const code of shapeless) {
    const continent = geonames.get(code);
    if (continent === undefined) fail(`no GeoNames continent for ${code}`);
    countries.set(code, { continent, shape: false });
  }
  for (const code of Object.keys(EDITORIAL))
    if (!countries.has(code)) fail(`editorial override for unknown ${code}`);
  if (countries.size !== geonames.size)
    fail(`map has ${countries.size} codes, GeoNames ${geonames.size}`);

  // ---- TopoJSON per level of detail -----------------------------------------------------------
  const outputs = new Map<string, string>();
  const sizes: string[] = [];
  for (const [res, fc] of Object.entries(ne)) {
    const byCode = new Map<string, Geometry[]>();
    const neutral: Feature[] = [];
    for (const f of fc.features) {
      const code = f.properties.ISO_A2_EH;
      if (code === "-99") neutral.push({ type: "Feature", properties: {}, geometry: f.geometry });
      else if (!countries.has(code)) fail(`${res}: code ${code} not in country map`);
      else byCode.set(code, [...(byCode.get(code) ?? []), f.geometry]);
    }
    neutral.sort((a, b) => JSON.stringify(a.geometry).localeCompare(JSON.stringify(b.geometry)));
    const features: Feature[] = [
      ...[...byCode.keys()].sort().map(
        (code): Feature => ({
          type: "Feature",
          id: code,
          properties: {},
          geometry: mergeGeometries(byCode.get(code) ?? []),
        }),
      ),
      ...neutral,
    ];
    const collection: FeatureCollection = { type: "FeatureCollection", features };
    const topo = topology(
      { countries: collection },
      QUANTIZATION[res as keyof typeof QUANTIZATION],
    );
    const json = JSON.stringify(topo);
    outputs.set(`data/world-${res}.topo.json`, `${json}\n`);
    sizes.push(
      `${res}: ${features.length} geometries, ${(json.length / 1024).toFixed(0)} KB raw, ${(gzipSync(json).length / 1024).toFixed(0)} KB gzip`,
    );
  }

  const entries = [...countries.entries()].sort(([a], [b]) => a.localeCompare(b));
  const ts = [
    "// GENERATED by packages/geo-data/scripts/build.ts. Do not edit; run `pnpm --filter @world-emotion/geo-data build:data`.",
    `// Sources: Natural Earth ${NE_VERSION} (public domain), GeoNames countryInfo (CC BY 4.0). Decisions: docs/geo-decisions.md`,
    'import type { Continent } from "@world-emotion/shared";',
    "",
    "/** [continent, has a Natural Earth shape] for every country code we accept. */",
    "export const COUNTRY_TABLE: Readonly<Record<string, readonly [Continent, boolean]>> = {",
    ...entries.map(([code, e]) => `  ${code}: ["${e.continent}", ${e.shape}],`),
    "};",
    "",
  ].join("\n");
  outputs.set("src/countries.generated.ts", ts);

  if (check) {
    const stale: string[] = [];
    for (const [rel, content] of outputs) {
      const path = join(ROOT, rel);
      if (!existsSync(path) || (await readFile(path, "utf8")) !== content) stale.push(rel);
    }
    if (stale.length > 0) fail(`generated files are stale: ${stale.join(", ")}. Run build:data.`);
    console.log("geo-data: generated files are up to date.");
    return;
  }
  await mkdir(join(ROOT, "data"), { recursive: true });
  for (const [rel, content] of outputs) await writeFile(join(ROOT, rel), content);
  console.log(`geo-data: ${countries.size} countries (${shapeless.length} without shapes).`);
  for (const s of sizes) console.log(`  ${s}`);
}

await main();
