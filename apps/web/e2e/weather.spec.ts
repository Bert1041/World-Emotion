/**
 * Mood weather rises from land (bridge U2). It used to spawn at each country's whole-shape centroid
 * plus up to 4° of jitter; 39 of 237 countries have that centroid outside themselves, so weather
 * drifted over open ocean. Now it starts at the pin point (inside) and spreads over the land in
 * idle time. Checked against the real 50m map, for every particle on the globe.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { geoBounds, geoContains, geoDistance } from "d3-geo";
import type { Feature, FeatureCollection } from "geojson";
import { feature } from "topojson-client";
import { pinPoint } from "../src/engine/pin";

/** The 50m map the app draws, read from the package directly (Node needs no JSON import attribute). */
function countries50m(): Feature[] {
  const path = createRequire(import.meta.url).resolve(
    "@world-emotion/geo-data/world-50m.topo.json",
  );
  const topo = JSON.parse(readFileSync(path, "utf8"));
  return (feature(topo, topo.objects.countries) as unknown as FeatureCollection).features;
}

type Weather = { spread: boolean; anchors: [number, number, number][] };
type Bench = { ready: Promise<void>; weather(): Weather };

test("every particle is anchored on land, before and after weather spreads", async ({
  page,
}, info) => {
  test.skip(!["phone-390", "laptop-1440"].includes(info.project.name), "behaviour, not layout");
  const countries = countries50m();
  expect(countries.length).toBeGreaterThan(230);
  const boxes = countries.map((f) => ({ f, b: geoBounds(f) }));
  /**
   * Anchors are float32: near ±180° that is about 1e-5° of rounding, and a zero-width box (Tuvalu's
   * in the 50m map) would otherwise reject its own pin point.
   */
  const EPS = 1e-4;
  const inBox = (
    [lon, lat]: [number, number],
    [[w, s], [e, n]]: [[number, number], [number, number]],
  ) =>
    lat >= s - EPS &&
    lat <= n + EPS &&
    (w <= e ? lon >= w - EPS && lon <= e + EPS : lon >= w - EPS || lon <= e + EPS);
  /** On land: inside some country, or within a hair of one (pin points on zero-area shapes). */
  const onLand = (p: [number, number]) =>
    boxes.some(({ f, b }) => inBox(p, b) && (geoContains(f, p) || pinLike(f, p)));
  /**
   * Zero-area shapes (Tuvalu, Vatican in the 50m map, pin.ts): nothing is inside them, so their
   * pin point sits on the line. Accept a country's own pin point (to float32 precision), nothing
   * looser.
   */
  const pins = new Map(countries.map((f) => [f, pinPoint(f)]));
  const pinLike = (f: Feature, p: [number, number]) =>
    geoDistance(p, pins.get(f) as [number, number]) < 1e-6;

  await page.goto("/?auto=0");
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  const weather = () =>
    page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.weather());

  // The field starts empty and fills as particles respawn (the first within about a second).
  await expect
    .poll(async () => (await weather()).anchors.length, { timeout: 5000 })
    .toBeGreaterThan(100);
  const early = await weather();
  const offEarly = early.anchors.filter(([lon, lat]) => !onLand([lon, lat]));
  expect(offEarly, "before spreading (pin points)").toEqual([]);

  await expect.poll(async () => (await weather()).spread, { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(4500); // every mood's particles live at most 7 s; most respawn by now
  const late = await weather();
  const distinctEarly = new Set(early.anchors.map(([a, b]) => `${a},${b}`)).size;
  const distinctLate = new Set(late.anchors.map(([a, b]) => `${a},${b}`)).size;
  expect(distinctLate, "spread over more of the land than one point per country").toBeGreaterThan(
    distinctEarly,
  );
  const offLate = late.anchors.filter(([lon, lat]) => !onLand([lon, lat]));
  expect(offLate, "after spreading").toEqual([]);
});
