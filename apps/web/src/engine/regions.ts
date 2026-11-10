import { mixOklab, oklabToCss } from "@world-emotion/motion";
import {
  type Continent,
  MOODS,
  type MoodId,
  type Snapshot,
  type SnapshotRegion,
} from "@world-emotion/shared";
import { type GeoProjection, geoContains } from "d3-geo";
import type { Bar, PanelView } from "../ui/view.svelte";
import type { Lod } from "./geo";
import type { SpawnPoint } from "./particles";

/**
 * Snapshot → what the screen shows: a region's colour, the card's model, the weather spawns and the
 * country under a tap. All pure: snapshot and focus in, values out (unit-tested in regions.test.ts).
 */

type Lab = Parameters<typeof mixOklab>[0];
export type CountryToContinent = ReadonlyMap<string, Continent>;

/** The Earth shown while the world is quiet (decision B4): Waterworld, with the halo dimmed. */
export const QUIET_THEME: MoodId = MOODS.indexOf("calm") as MoodId;

/**
 * The world headline (ADR 0003, README §5.4): below the privacy floor the world is *quiet*, with no
 * mood word, because `h` for an empty world is a tie-break, not a feeling. The theme follows the
 * headline when there is one and rests on the quiet Earth otherwise.
 */
export function worldHeadline(
  snapshot: Pick<Snapshot, "world">,
  floor: number,
): { readonly quiet: boolean; readonly mood: MoodId | null; readonly theme: MoodId } {
  const quiet = snapshot.world.n < floor;
  return {
    quiet,
    mood: quiet ? null : snapshot.world.h,
    theme: quiet ? QUIET_THEME : snapshot.world.h,
  };
}

/** How clearly a region leads with its headline: 0 (dead heat) … 1 (clear). */
export function clarity(r: SnapshotRegion): number {
  const sorted = [...r.dist].sort((a, b) => b - a);
  return Math.min(1, ((sorted[0] ?? 0) - (sorted[1] ?? 0)) / 0.25);
}

/** A country's region, falling back to its continent when below the privacy floor. */
export function regionOf(
  snapshot: Snapshot,
  code: string,
  map: CountryToContinent,
): { region: SnapshotRegion; quiet: boolean } | null {
  const own = snapshot.countries[code];
  if (own) return { region: own, quiet: false };
  const c = map.get(code);
  const parent = c ? snapshot.continents[c] : undefined;
  return parent ? { region: parent, quiet: true } : null;
}

export function barsOf(r: SnapshotRegion, colors: readonly string[]): Bar[] {
  return MOODS.map((_, m) => ({
    mood: m as MoodId,
    share: r.dist[m] ?? 0,
    pct: Math.round((r.dist[m] ?? 0) * 100),
    color: colors[m] ?? "#fff",
    lead: m === r.h,
  }));
}

/** "feels <mood>": the mood is always named, never colour alone. */
const moodOf = (m: MoodId | null, colors: readonly string[]) =>
  m === null ? null : { id: m, color: colors[m] ?? "" };

/** The region card's model, or null in the world view. */
export function panelModel(
  snapshot: Snapshot,
  focus: Continent | null,
  selected: string | null,
  map: CountryToContinent,
  colors: readonly string[],
): PanelView | null {
  if (focus === null) return null;
  if (selected !== null) {
    const r = regionOf(snapshot, selected, map);
    return {
      place: { kind: "country", code: selected },
      mood: moodOf(r && !r.quiet ? r.region.h : null, colors),
      status: !r
        ? { kind: "none" }
        : r.quiet
          ? { kind: "quietShowing", continent: focus }
          : { kind: "count", n: r.region.n },
      bars: r ? barsOf(r.region, colors) : [],
    };
  }
  const r = snapshot.continents[focus];
  return {
    place: { kind: "continent", id: focus },
    mood: moodOf(r ? r.h : null, colors),
    status: r ? { kind: "count", n: r.n } : { kind: "quiet" },
    bars: r ? barsOf(r, colors) : [],
  };
}

/** Fill colour per country: the theme's land tinted toward the region's mood by its clarity. */
export function countryFills(
  snapshot: Snapshot,
  map: CountryToContinent,
  focus: Continent | null,
  theme: { readonly land: Lab; readonly ocean: Lab },
  moodLab: readonly Lab[],
): Map<string, string> {
  const fills = new Map<string, string>();
  for (const code of map.keys()) {
    const r = regionOf(snapshot, code, map);
    // Quantised strength keeps the number of distinct fills (= fill calls) small.
    const strength = r ? Math.round(clarity(r.region) * (r.quiet ? 0.4 : 1) * 3) / 3 : 0;
    let col = r
      ? mixOklab(theme.land, moodLab[r.region.h] ?? theme.land, 0.12 + 0.7 * strength)
      : theme.land;
    if (focus !== null && map.get(code) !== focus) col = mixOklab(col, theme.ocean, 0.7);
    fills.set(code, oklabToCss(col));
  }
  return fills;
}

export interface Centroid {
  readonly code: string;
  readonly lon: number;
  readonly lat: number;
}

/** Where mood weather spawns and how strongly (README §8.2.3: quiet regions are faint). */
export function weatherSpawns(
  snapshot: Snapshot,
  centroids: readonly Centroid[],
  map: CountryToContinent,
  focus: Continent | null,
): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  for (const { code, lon, lat } of centroids) {
    const r = regionOf(snapshot, code, map);
    if (!r) continue;
    if (focus !== null && map.get(code) !== focus) continue;
    const weight = (0.05 + clarity(r.region)) * (r.quiet ? 0.3 : 1) * Math.log10(10 + r.region.n);
    spawns.push({ lon, lat, mood: r.region.h, weight });
  }
  return spawns;
}

export interface Hit {
  readonly code: string;
  readonly continent: Continent;
  readonly lonLat: [number, number];
}

/** Country and continent under a screen point (CSS px), or null for ocean, space or no map yet. */
export function hitCountry(
  x: number,
  y: number,
  o: {
    projection: GeoProjection;
    dpr: number;
    countries: Lod["countries"] | undefined;
    map: CountryToContinent;
  },
): Hit | null {
  if (!o.countries) return null; // before the map has loaded (audit E8)
  const lonLat = o.projection.invert?.([x * o.dpr, y * o.dpr]);
  const [tx, ty] = o.projection.translate();
  if (!lonLat || Math.hypot(x * o.dpr - tx, y * o.dpr - ty) > o.projection.scale()) return null;
  const hit = o.countries.find((f) => geoContains(f, lonLat));
  const code = hit ? String(hit.id) : null;
  const continent = code ? o.map.get(code) : undefined;
  return code !== null && continent !== undefined
    ? { code, continent, lonLat: [lonLat[0], lonLat[1]] }
    : null;
}

/**
 * Below this many check-ins a region's published shares are mostly shrinkage (k = 15 virtual votes
 * pull toward the parent, README §5.4): four calm people in the world read as a 34 % calm share.
 * A per-mood number from that would be wrong, so the line falls back to a wider region, and in an
 * early world to the one exact figure there is: the raw count `n`.
 */
export const ALONGSIDE_MIN_N = 50;

/** Who else feels what you feel (bridge R1): the line under "You feel …" after a check-in. */
export type Alongside =
  | {
      /** Your country when it has enough check-ins; otherwise the world. */
      readonly scope: "country" | "world";
      /** People in that scope with your mood, not counting you. 0 means you are the first. */
      readonly others: number;
      /** The country's headline mood (country scope only; the header names the world's). */
      readonly feels: MoodId | null;
    }
  | {
      /** An early world: no per-mood number is honest yet. */
      readonly scope: "early";
      /** Everyone who has checked in, you included (exact, at least 1). */
      readonly total: number;
    };

/**
 * Real numbers from the snapshot, never a placeholder: `dist[mood] × n` of your region, minus you
 * (the aggregator's estimate, the same one the card's bars show). Until the next aggregation run
 * counts your vote it reads one low; it never reads high and never below zero.
 */
export function alongside(snapshot: Snapshot, country: string, mood: MoodId): Alongside {
  const own = snapshot.countries[country];
  const region = own && own.n >= ALONGSIDE_MIN_N ? own : snapshot.world;
  if (region.n < ALONGSIDE_MIN_N) return { scope: "early", total: Math.max(1, snapshot.world.n) };
  const withYou = Math.round((region.dist[mood] ?? 0) * region.n);
  return {
    scope: region === own ? "country" : "world",
    others: Math.max(0, withYou - 1),
    feels: region === own ? own.h : null,
  };
}

/**
 * Which Earth to show (bridge T1, decision B1): the region you are looking at. The world view
 * follows the world headline; zoomed into a continent, that continent's mood, so every Earth can
 * be visited. A continent below the privacy floor (absent from the snapshot) rests on the quiet
 * Earth, like a quiet world.
 */
export function themeFor(snapshot: Snapshot, focus: Continent | null, floor: number): MoodId {
  if (focus === null) return worldHeadline(snapshot, floor).theme;
  return snapshot.continents[focus]?.h ?? QUIET_THEME;
}
