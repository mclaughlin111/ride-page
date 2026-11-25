import proj4 from "proj4";
import { manifest } from "./terrain/heightfield";

/**
 * GPS track parsing and validation for the map overlay. Every source format
 * is reduced to [lon, lat] pairs, then cleaned, checked against the mapping
 * requirements and converted to British National Grid metres (EPSG:27700)
 * to match the terrain.
 *
 * A track is mappable when, after dropping bad points, it still has at
 * least MIN_POINTS ordered positions spanning MIN_LENGTH_M, with valid start
 * and end coordinates (taken from the track itself, so missing ride or route
 * metadata never makes an otherwise good track unmappable).
 */

export const MIN_POINTS = 5;
export const MIN_LENGTH_M = 500;
/** Douglas-Peucker tolerance; far below the 50 m terrain grid. */
const SIMPLIFY_M = 4;
/** Upper bound on points sent to the browser, whatever the source size. */
export const MAX_POINTS = 8000;
/** A lone point this far from both neighbours (which are close together) is a GPS glitch. */
const SPIKE_M = 1000;

export type TrackFormat = "rwgps" | "geojson" | "gpx" | "unknown";

export type TrackDiagnostics = {
  format: TrackFormat;
  /** Points found in the source before any cleaning. */
  received: number;
  /** Non-numeric, missing or non-finite values. */
  malformed: number;
  /** Latitude outside ±90 or longitude outside ±180. */
  outOfRange: number;
  /** 0,0 placeholders written by some devices before a fix. */
  nullIsland: number;
  duplicates: number;
  spikes: number;
  /** True when lat/lon were found reversed and swapped back. */
  swapped: boolean;
  /** Points after cleaning, before simplification. */
  valid: number;
  /** Points kept after simplification. */
  kept: number;
};

export type TrackIssue = "no_track" | "too_few_points" | "too_short" | "outside_map";

export type MappableTrack = {
  ok: true;
  /** Flattened [e0, n0, e1, n1, ...] rounded BNG metres. */
  points: number[];
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  bounds: { west: number; south: number; east: number; north: number };
  lengthM: number;
  diagnostics: TrackDiagnostics;
};

export type RejectedTrack = {
  ok: false;
  issue: TrackIssue;
  reason: string;
  diagnostics: TrackDiagnostics;
};

const BNG =
  "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 " +
  "+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs";
export const toBng = proj4("EPSG:4326", BNG);

type Raw = [unknown, unknown];

const num = (v: unknown) =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;

/** RWGPS track_points: x = lon, y = lat (also accepts lon/lng/lat keys). */
function fromPointObjects(points: unknown[]): Raw[] {
  return points.map((p) => {
    if (!p || typeof p !== "object") return [NaN, NaN];
    const o = p as Record<string, unknown>;
    return [o.x ?? o.lon ?? o.lng, o.y ?? o.lat];
  });
}

/** GeoJSON positions are [lon, lat, (ele)]. */
function fromGeoJson(value: unknown): Raw[] | null {
  if (!value || typeof value !== "object") return null;
  const g = value as { type?: unknown; coordinates?: unknown; geometry?: unknown; features?: unknown };
  const positions = (coords: unknown): Raw[] =>
    Array.isArray(coords)
      ? coords.map((c) => (Array.isArray(c) ? [c[0], c[1]] : [NaN, NaN]))
      : [];
  switch (g.type) {
    case "LineString":
      return positions(g.coordinates);
    case "MultiLineString":
      return Array.isArray(g.coordinates) ? g.coordinates.flatMap(positions) : [];
    case "Feature":
      return fromGeoJson(g.geometry) ?? [];
    case "FeatureCollection":
      return Array.isArray(g.features) ? g.features.flatMap((f) => fromGeoJson(f) ?? []) : [];
    case "GeometryCollection": {
      const geoms = (value as { geometries?: unknown }).geometries;
      return Array.isArray(geoms) ? geoms.flatMap((x) => fromGeoJson(x) ?? []) : [];
    }
    default:
      return null;
  }
}

/** GPX track points (trkpt), falling back to route points (rtept). */
function fromGpx(text: string): Raw[] {
  const read = (tag: string) => {
    const out: Raw[] = [];
    for (const m of text.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))) {
      const attrs = m[1];
      const lat = attrs.match(/\blat\s*=\s*["']([^"']*)["']/)?.[1];
      const lon = attrs.match(/\blon\s*=\s*["']([^"']*)["']/)?.[1];
      out.push([lon, lat]);
    }
    return out;
  };
  const trk = read("trkpt");
  return trk.length ? trk : read("rtept");
}

/** Reduces any supported source to raw [lon, lat] pairs in track order. */
export function extractTrack(source: unknown): { format: TrackFormat; coords: Raw[] } {
  if (typeof source === "string") {
    if (/<gpx[\s>]/i.test(source)) return { format: "gpx", coords: fromGpx(source) };
    try {
      return extractTrack(JSON.parse(source));
    } catch {
      return { format: "unknown", coords: [] };
    }
  }
  if (source && typeof source === "object") {
    const o = source as Record<string, unknown>;
    const route = (o.route ?? o.trip ?? o) as Record<string, unknown>;
    if (route && Array.isArray(route.track_points)) {
      return { format: "rwgps", coords: fromPointObjects(route.track_points) };
    }
    const geo = fromGeoJson(source);
    if (geo) return { format: "geojson", coords: geo };
  }
  return { format: "unknown", coords: [] };
}

const region = manifest.datasets.find((d) => d.id === "region") ?? manifest.datasets[0];

function inRegion(e: number, n: number) {
  return (
    e >= region.west &&
    e <= region.west + region.cols * region.cell &&
    n <= region.north &&
    n >= region.north - region.rows * region.cell
  );
}

/**
 * Lat/lon order is fixed per format, but hand-made files sometimes reverse
 * it. Swap only when the reversed reading lands on the map and the given
 * one mostly does not.
 */
function looksSwapped(points: [number, number][]): boolean {
  const step = Math.max(1, Math.floor(points.length / 200));
  let asIs = 0;
  let swapped = 0;
  let sampled = 0;
  for (let i = 0; i < points.length; i += step) {
    const [lon, lat] = points[i];
    sampled++;
    const [e, n] = toBng.forward([lon, lat]);
    if (inRegion(e, n)) asIs++;
    if (Math.abs(lon) <= 90) {
      const [e2, n2] = toBng.forward([lat, lon]);
      if (inRegion(e2, n2)) swapped++;
    }
  }
  return asIs < sampled / 2 && swapped > asIs;
}

/** Iterative Douglas-Peucker over flat [x0, y0, ...] arrays. */
function simplify(flat: number[], tolerance: number): number[] {
  const count = flat.length / 2;
  if (count < 3) return flat;
  const keep = new Uint8Array(count);
  keep[0] = keep[count - 1] = 1;
  const stack: [number, number][] = [[0, count - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = flat[a * 2];
    const ay = flat[a * 2 + 1];
    const dx = flat[b * 2] - ax;
    const dy = flat[b * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy || 1;
    let worst = -1;
    let worstD = t2;
    for (let i = a + 1; i < b; i++) {
      const px = flat[i * 2] - ax;
      const py = flat[i * 2 + 1] - ay;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d = ex * ex + ey * ey;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (keep[i]) out.push(flat[i * 2], flat[i * 2 + 1]);
  return out;
}

/**
 * Cleans a raw track and decides whether it can be mapped. Bad points are
 * dropped individually; the track is rejected only when what remains is not
 * enough to draw a meaningful route.
 */
export function validateTrack(format: TrackFormat, coords: Raw[]): MappableTrack | RejectedTrack {
  const d: TrackDiagnostics = {
    format,
    received: coords.length,
    malformed: 0,
    outOfRange: 0,
    nullIsland: 0,
    duplicates: 0,
    spikes: 0,
    swapped: false,
    valid: 0,
    kept: 0,
  };
  const reject = (issue: TrackIssue, reason: string): RejectedTrack => ({
    ok: false,
    issue,
    reason,
    diagnostics: d,
  });
  if (!coords.length) return reject("no_track", "Route has no GPS track points.");

  let lonLat: [number, number][] = [];
  for (const [rawLon, rawLat] of coords) {
    const lon = num(rawLon);
    const lat = num(rawLat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) d.malformed++;
    else if (Math.abs(lat) > 90 || Math.abs(lon) > 180) d.outOfRange++;
    else if (lat === 0 && lon === 0) d.nullIsland++;
    else lonLat.push([lon, lat]);
  }
  if (lonLat.length && looksSwapped(lonLat)) {
    d.swapped = true;
    lonLat = lonLat.map(([lon, lat]) => [lat, lon]);
  }

  // Project, dropping consecutive duplicates.
  const grid: number[] = [];
  const kept: [number, number][] = [];
  for (const p of lonLat) {
    const [e, n] = toBng.forward(p);
    const last = grid.length - 2;
    if (last >= 0 && Math.abs(grid[last] - e) < 0.5 && Math.abs(grid[last + 1] - n) < 0.5) {
      d.duplicates++;
      continue;
    }
    grid.push(e, n);
    kept.push(p);
  }

  // Drop isolated spikes: far from both neighbours that are close to each other.
  const dist = (i: number, j: number) =>
    Math.hypot(grid[i * 2] - grid[j * 2], grid[i * 2 + 1] - grid[j * 2 + 1]);
  const flat: number[] = [];
  const ends: [number, number][] = [];
  const count = grid.length / 2;
  let prev = -1;
  for (let i = 0; i < count; i++) {
    const next = i + 1 < count ? i + 1 : -1;
    if (
      prev >= 0 &&
      next >= 0 &&
      dist(prev, i) > SPIKE_M &&
      dist(i, next) > SPIKE_M &&
      dist(prev, next) < SPIKE_M / 2
    ) {
      d.spikes++;
      continue;
    }
    flat.push(grid[i * 2], grid[i * 2 + 1]);
    ends.push(kept[i]);
    prev = i;
  }

  d.valid = flat.length / 2;
  if (d.valid < MIN_POINTS) {
    return reject(
      d.valid === 0 ? "no_track" : "too_few_points",
      d.valid === 0
        ? "Route GPS track has no usable points."
        : `Route GPS track has only ${d.valid} usable points.`,
    );
  }
  let lengthM = 0;
  for (let k = 2; k < flat.length; k += 2) {
    lengthM += Math.hypot(flat[k] - flat[k - 2], flat[k + 1] - flat[k - 1]);
  }
  if (lengthM < MIN_LENGTH_M) {
    return reject("too_short", `Route GPS track is only ${Math.round(lengthM)} m long.`);
  }

  let simple = simplify(flat, SIMPLIFY_M);
  for (let tol = SIMPLIFY_M * 2; simple.length / 2 > MAX_POINTS; tol *= 2) {
    simple = simplify(flat, tol);
  }
  const points = simple.map(Math.round);
  d.kept = points.length / 2;

  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  let inside = 0;
  for (let k = 0; k < points.length; k += 2) {
    west = Math.min(west, points[k]);
    east = Math.max(east, points[k]);
    south = Math.min(south, points[k + 1]);
    north = Math.max(north, points[k + 1]);
    if (inRegion(points[k], points[k + 1])) inside++;
  }
  if (inside === 0) {
    return reject("outside_map", "Route is entirely outside the map area.");
  }
  const [startLon, startLat] = ends[0];
  const [endLon, endLat] = ends[ends.length - 1];
  return {
    ok: true,
    points,
    start: { lat: startLat, lon: startLon },
    end: { lat: endLat, lon: endLon },
    bounds: { west, south, east, north },
    lengthM: Math.round(lengthM),
    diagnostics: d,
  };
}

/** Parses and validates any supported track source in one step. */
export function parseTrack(source: unknown): MappableTrack | RejectedTrack {
  const { format, coords } = extractTrack(source);
  return validateTrack(format, coords);
}

/** True when the diagnostics show points were dropped or repaired. */
export function trackWasRepaired(d: TrackDiagnostics): boolean {
  return d.malformed + d.outOfRange + d.nullIsland + d.spikes > 0 || d.swapped;
}
