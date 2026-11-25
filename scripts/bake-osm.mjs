#!/usr/bin/env node
// Bakes OpenStreetMap features for the detailed terrain extents (Bristol and
// Avon) from Geofabrik county extracts into compact overlays used by the map
// view:
//   public/terrain/osm-<id>.bin  Int16 little-endian records (see below)
//   lib/terrain/osm.json         class list, attribution and per-overlay
//                                file name, origin and feature counts
//
// Download the extracts first (OSM data is ODbL, © OpenStreetMap contributors):
//   mkdir -p osm && cd osm
//   for c in bristol somerset gloucestershire; do
//     curl -LO https://download.geofabrik.de/europe/united-kingdom/england/$c-latest.osm.pbf
//   done
//
// Usage: node scripts/bake-osm.mjs [osm-dir]   (run after bake-terrain.mjs)
//
// Record layout, repeated: classId, ringCount, then per ring: pointCount,
// x0, y0, x1, y1, ... where x/y are metres east/north of the dataset centre
// (so a dataset may be at most ~65 km across).

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createOSMStream } from "osm-pbf-parser-node";
import proj4 from "proj4";

const ROOT = path.resolve(import.meta.dirname, "..");
const OSM_DIR = path.resolve(process.argv[2] ?? path.join(ROOT, "osm"));
const MANIFEST = path.join(ROOT, "lib", "terrain", "manifest.json");
const OUT_DIR = path.join(ROOT, "public", "terrain");
const OUT_META = path.join(ROOT, "lib", "terrain", "osm.json");

/**
 * Terrain datasets that get an overlay. Simplification tolerances scale with
 * the dataset cell size so coarser areas stay small on the wire.
 */
const OVERLAYS = ["bristol", "avon"];

const BNG =
  "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 " +
  "+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs";
const toBng = proj4("EPSG:4326", BNG);

/** Fill classes are rasterised onto the terrain; line classes are draped. */
const CLASSES = [
  { id: "residential", kind: "fill" },
  { id: "commercial", kind: "fill" },
  { id: "industrial", kind: "fill" },
  { id: "open", kind: "fill" },
  { id: "park", kind: "fill" },
  { id: "wood", kind: "fill" },
  { id: "water", kind: "fill" },
  { id: "stream", kind: "line" },
  { id: "river", kind: "line" },
  { id: "footpath", kind: "line" },
  { id: "bridleway", kind: "line" },
  { id: "cycleway", kind: "line" },
  { id: "road_minor", kind: "line" },
  { id: "road_secondary", kind: "line" },
  { id: "road_major", kind: "line" },
  { id: "rail", kind: "line" },
  { id: "bridge", kind: "line" },
];
const CLASS_ID = Object.fromEntries(CLASSES.map((c, i) => [c.id, i]));

const has = (v, ...values) => v !== undefined && values.includes(v);

function lineClass(t) {
  const h = t.highway;
  if (h) {
    if (has(t.area, "yes")) return null;
    if (has(h, "motorway", "trunk", "primary", "motorway_link", "trunk_link", "primary_link"))
      return "road_major";
    if (has(h, "secondary", "tertiary", "secondary_link", "tertiary_link")) return "road_secondary";
    if (has(h, "residential", "unclassified", "living_street")) return "road_minor";
    if (h === "cycleway" || (h === "path" && has(t.bicycle, "designated"))) return "cycleway";
    if (has(h, "bridleway", "track")) return "bridleway";
    if (has(h, "footway", "path", "steps", "pedestrian")) return "footpath";
    return null;
  }
  if (has(t.railway, "rail", "light_rail", "narrow_gauge") && !t.service) return "rail";
  if (has(t.waterway, "river", "canal")) return "river";
  if (has(t.waterway, "stream")) return "stream";
  return null;
}

function fillClass(t) {
  if (has(t.natural, "water") || has(t.landuse, "reservoir", "basin") || has(t.waterway, "riverbank", "dock"))
    return "water";
  if (has(t.natural, "wood") || has(t.landuse, "forest")) return "wood";
  if (
    has(t.leisure, "park", "garden", "recreation_ground", "golf_course", "pitch", "playground") ||
    has(t.landuse, "grass", "recreation_ground", "village_green", "cemetery", "allotments") ||
    has(t.amenity, "grave_yard")
  )
    return "park";
  // Open countryside and natural ground: farmland, meadow, heath, scrub, moor.
  if (
    has(t.natural, "heath", "scrub", "grassland", "moor", "fell", "wetland", "bare_rock", "scree") ||
    has(t.landuse, "meadow", "farmland", "orchard", "vineyard") ||
    has(t.leisure, "nature_reserve", "common")
  )
    return "open";
  if (has(t.landuse, "residential")) return "residential";
  if (has(t.landuse, "commercial", "retail")) return "commercial";
  // Industry and infrastructure.
  if (
    has(t.landuse, "industrial", "railway", "port", "quarry", "landfill", "construction", "brownfield", "garages", "depot") ||
    has(t.aeroway, "aerodrome") ||
    has(t.power, "plant", "substation")
  )
    return "industrial";
  return null;
}

/** Coarser simplification for large, soft-edged areas keeps the file small. */
const FILL_TOLERANCE = { open: 4, residential: 3 };
const LINE_TOLERANCE = 1.5;
const DEFAULT_FILL_TOLERANCE = 2;

const isClosed = (refs) => refs.length > 3 && refs[0] === refs[refs.length - 1];

/** Douglas-Peucker on [x, y] arrays. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let worst = -1;
    let worstD = t2;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + k * dx - px;
      const ey = ay + k * dy - py;
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
  return points.filter((_, i) => keep[i]);
}

/** Joins open way segments into closed rings by matching end node ids. */
function joinRings(segments) {
  const rings = [];
  const pool = segments.filter((s) => s.length > 1).map((s) => [...s]);
  while (pool.length) {
    let ring = pool.pop();
    let grown = true;
    while (ring[0] !== ring[ring.length - 1] && grown) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        const end = ring[ring.length - 1];
        if (s[0] === end) ring = ring.concat(s.slice(1));
        else if (s[s.length - 1] === end) ring = ring.concat([...s].reverse().slice(1));
        else if (s[s.length - 1] === ring[0]) ring = s.concat(ring.slice(1));
        else if (s[0] === ring[0]) ring = [...s].reverse().concat(ring.slice(1));
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (ring[0] === ring[ring.length - 1] && ring.length > 3) rings.push(ring);
  }
  return rings;
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

const files = existsSync(OSM_DIR)
  ? readdirSync(OSM_DIR).filter((f) => f.endsWith(".osm.pbf")).map((f) => path.join(OSM_DIR, f))
  : [];
if (!files.length) throw new Error(`No .osm.pbf files in ${OSM_DIR}`);

// Pass 1 (once): multipolygon relations we want, and the ways they need.
const relations = new Map();
const memberWays = new Set();
for (const file of files) {
  for await (const item of createOSMStream(file, { withInfo: false })) {
    if (item.type !== "relation") continue;
    const t = item.tags ?? {};
    if (t.type !== "multipolygon" || relations.has(item.id)) continue;
    const cls = fillClass(t);
    if (!cls) continue;
    const members = item.members.filter((m) => m.type === "way");
    relations.set(item.id, { cls, members });
    members.forEach((m) => memberWays.add(m.ref));
  }
}
console.log(`pass 1: ${relations.size} multipolygons`);

async function bakeOverlay(dataset) {
  const west = dataset.west;
  const east = dataset.west + dataset.cols * dataset.cell;
  const north = dataset.north;
  const south = dataset.north - dataset.rows * dataset.cell;
  const cx = (west + east) / 2;
  const cy = (north + south) / 2;
  if (Math.max(east - west, north - south) / 2 + 2000 > 32767) {
    throw new Error(`${dataset.id}: too large for Int16 offsets from the centre`);
  }
  const MARGIN = 1000;
  const inBox = (e, n) =>
    e >= west - MARGIN && e <= east + MARGIN && n >= south - MARGIN && n <= north + MARGIN;
  const tol = dataset.cell / 50;

  // Pass 2: node positions inside the box, wanted ways and relation members.
  const nodes = new Map();
  const ways = new Map();
  const wayRefs = new Map();
  for (const file of files) {
    for await (const item of createOSMStream(file, { withInfo: false })) {
      if (item.type === "node") {
        if (nodes.has(item.id)) continue;
        const [e, n] = toBng.forward([item.lon, item.lat]);
        if (inBox(e, n)) nodes.set(item.id, [e - cx, n - cy]);
      } else if (item.type === "way") {
        if (ways.has(item.id) || wayRefs.has(item.id)) continue;
        const t = item.tags ?? {};
        if (!item.refs.some((r) => nodes.has(r))) continue;
        if (memberWays.has(item.id)) wayRefs.set(item.id, item.refs);
        const line = lineClass(t);
        const fill = !line && isClosed(item.refs) ? fillClass(t) : null;
        if (line || fill) {
          const bridge = line?.startsWith("road") && has(t.bridge, "yes", "viaduct");
          ways.set(item.id, { cls: line ?? fill, refs: item.refs, bridge });
        }
      }
    }
  }
  console.log(`${dataset.id} pass 2: ${nodes.size} nodes, ${ways.size} ways`);

  const records = [];
  const clampX = (x) => Math.max(west - MARGIN - cx, Math.min(east + MARGIN - cx, x));
  const clampY = (y) => Math.max(south - MARGIN - cy, Math.min(north + MARGIN - cy, y));

  function addLine(cls, refs) {
    // Split where the line leaves the box (missing nodes).
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const pts = simplify(run, LINE_TOLERANCE * tol);
        for (let i = 0; i < pts.length - 1; i += 4000) {
          records.push({ cls, rings: [pts.slice(i, i + 4001)] });
        }
      }
      run = [];
    };
    for (const r of refs) {
      const p = nodes.get(r);
      if (p) run.push(p);
      else flush();
    }
    flush();
  }

  function ringPoints(refs, cls) {
    const pts = [];
    for (const r of refs) {
      const p = nodes.get(r);
      if (p) pts.push([clampX(p[0]), clampY(p[1])]);
    }
    return pts.length > 3 ? simplify(pts, (FILL_TOLERANCE[cls] ?? DEFAULT_FILL_TOLERANCE) * tol) : null;
  }

  for (const w of ways.values()) {
    const kind = CLASSES[CLASS_ID[w.cls]].kind;
    if (kind === "line") {
      addLine(w.cls, w.refs);
      if (w.bridge) addLine("bridge", w.refs);
    } else {
      const ring = ringPoints(w.refs, w.cls);
      if (ring) records.push({ cls: w.cls, rings: [ring] });
    }
  }

  let mpCount = 0;
  for (const rel of relations.values()) {
    const segs = rel.members.map((m) => wayRefs.get(m.ref)).filter(Boolean);
    if (!segs.length) continue;
    const rings = joinRings(segs)
      .map((r) => ringPoints(r, rel.cls))
      .filter(Boolean);
    if (!rings.length) continue;
    records.push({ cls: rel.cls, rings });
    mpCount++;
  }

  // Draw order: fills first (by class order), then lines from minor to major.
  records.sort((a, b) => CLASS_ID[a.cls] - CLASS_ID[b.cls]);

  const out = [];
  const counts = Object.fromEntries(CLASSES.map((c) => [c.id, 0]));
  for (const rec of records) {
    out.push(CLASS_ID[rec.cls], rec.rings.length);
    for (const ring of rec.rings) {
      if (ring.length > 32767) throw new Error("ring too long");
      out.push(ring.length);
      for (const [x, y] of ring) out.push(Math.round(x), Math.round(y));
    }
    counts[rec.cls]++;
  }
  const data = Int16Array.from(out);
  const file = `osm-${dataset.id}.bin`;
  writeFileSync(path.join(OUT_DIR, file), Buffer.from(data.buffer));
  console.log(
    `${dataset.id}: wrote ${records.length} features (${mpCount} multipolygons), ` +
      `${(data.byteLength / 1e6).toFixed(1)} MB`,
    counts,
  );
  return { dataset: dataset.id, file, origin: { e: cx, n: cy }, counts };
}

const overlays = [];
for (const id of OVERLAYS) {
  const dataset = manifest.datasets.find((d) => d.id === id);
  if (!dataset) throw new Error(`Dataset ${id} not in manifest. Run scripts/bake-terrain.mjs first.`);
  overlays.push(await bakeOverlay(dataset));
}

writeFileSync(
  OUT_META,
  `${JSON.stringify(
    {
      source: "OpenStreetMap via Geofabrik extracts",
      attribution: "© OpenStreetMap contributors (ODbL)",
      classes: CLASSES.map((c) => c.id),
      kinds: CLASSES.map((c) => c.kind),
      overlays,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${path.relative(ROOT, OUT_META)}`);
