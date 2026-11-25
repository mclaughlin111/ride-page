#!/usr/bin/env node
// Bakes OS Terrain 50 ASCII grid tiles (terr50_gagg_gb/) into compact
// heightfields used by the map view:
//   public/terrain/<id>.bin   Int16 little-endian, decimetres, row 0 = north,
//                             NODATA (-32768) where no source tile exists (sea).
//   lib/terrain/manifest.json dataset metadata and landmark positions.
//
// Usage: node scripts/bake-terrain.mjs [path/to/terr50_gagg_gb]
// Requires the `unzip` command line tool.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import proj4 from "proj4";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.resolve(process.argv[2] ?? path.join(ROOT, "terr50_gagg_gb"));
const OUT_BIN = path.join(ROOT, "public", "terrain");
const OUT_MANIFEST = path.join(ROOT, "lib", "terrain", "manifest.json");

const NODATA = -32768;
const SRC_CELL = 50;
const TILE = 10_000;

const BNG =
  "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 " +
  "+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs";
const toBng = proj4("EPSG:4326", BNG);
const en = (lon, lat) => {
  const [e, n] = toBng.forward([lon, lat]);
  return { e: Math.round(e), n: Math.round(n) };
};

const CENTRE = { lat: 51.4545, lon: -2.5879 };
// Wide enough for Avonmouth to Keynsham and south past Chew Valley Lake.
const BRISTOL_BBOX = { west: -2.76, south: 51.29, east: -2.46, north: 51.53 };
// Roughly twice the Bristol extent each way: Severn Bridge to Wells, Clevedon
// to Bath, taking in the whole Mendip scarp (Cheddar Gorge, Burrington Combe).
const AVON_BBOX = { west: -2.95, south: 51.19, east: -2.33, north: 51.63 };
const AVON_CELL = 100;
const REGION_RADIUS = 160_000;
const REGION_CELL = 1000;

// [name, lat, lon, optional { end: [lat, lon] } for features with a span]
const BRISTOL_LANDMARKS = [
  ["Clifton Down", 51.4655, -2.6205],
  ["Clifton Suspension Bridge", 51.4548, -2.6281, { end: [51.4546, -2.6266], start: [51.4549, -2.6297] }],
  ["Clifton", 51.4572, -2.6155],
  ["Constitution Hill", 51.4524, -2.6098],
  ["Chew Valley Lake", 51.3365, -2.6175],
  ["Avon Gorge", 51.4625, -2.6305],
  ["Brandon Hill", 51.4537, -2.6053],
  ["Park Street", 51.4557, -2.6008],
  ["Belmont Hill", 51.4385, -2.6665],
  ["Ashton Court", 51.4455, -2.6435],
  ["Harbourside", 51.4492, -2.5985],
  ["River Avon", 51.4447, -2.573],
  ["Dundry Hill", 51.3985, -2.639],
];

const AVON_LANDMARKS = [
  ["Bristol", 51.4545, -2.5879],
  ["Bath", 51.3811, -2.359],
  ["Wells", 51.2094, -2.6472],
  ["Clevedon", 51.438, -2.854],
  ["Portishead", 51.4845, -2.765],
  ["Thornbury", 51.609, -2.5253],
  ["Severn Bridge", 51.6095, -2.638],
  ["Avonmouth", 51.5005, -2.699],
  ["Keynsham", 51.4135, -2.4968],
  ["Clifton Suspension Bridge", 51.4548, -2.6281, { end: [51.4546, -2.6266], start: [51.4549, -2.6297] }],
  ["Dundry Hill", 51.3985, -2.639],
  ["Chew Valley Lake", 51.3365, -2.6175],
  ["Blagdon Lake", 51.333, -2.715],
  ["Cheddar Gorge", 51.2858, -2.758],
  ["Cheddar Reservoir", 51.278, -2.795],
  ["Burrington Combe", 51.3215, -2.749],
  ["Black Down", 51.3155, -2.7306],
  ["Crook Peak", 51.299, -2.864],
  ["Priddy", 51.2565, -2.681],
  ["Lansdown", 51.42, -2.38],
  ["Kelston Round Hill", 51.405, -2.428],
  ["Wrington", 51.36, -2.765],
  ["Chew Magna", 51.365, -2.61],
];

const REGION_LANDMARKS = [
  ["Bristol", 51.4545, -2.5879],
  ["Bath", 51.3811, -2.359],
  ["Cardiff", 51.4816, -3.1791],
  ["Gloucester", 51.8642, -2.2382],
  ["Swindon", 51.5558, -1.7797],
  ["Exeter", 50.7184, -3.5339],
  ["Mendip Hills", 51.3115, -2.7275],
  ["Cotswold Edge", 51.75, -2.17],
  ["Pen y Fan", 51.884, -3.4369],
  ["Dunkery Beacon", 51.162, -3.587],
  ["Dartmoor", 50.57, -3.92],
  ["Salisbury Plain", 51.22, -1.9],
  ["Malvern Hills", 52.104, -2.343],
  ["Black Mountains", 51.96, -3.08],
];

/** OS National Grid 100 km square letters for an easting/northing. */
function gridLetters(e, n) {
  const e100 = Math.floor(e / 100_000);
  const n100 = Math.floor(n / 100_000);
  let l1 = 19 - n100 - ((19 - n100) % 5) + Math.floor((e100 + 10) / 5);
  let l2 = (((19 - n100) * 5) % 25) + (e100 % 5);
  if (l1 > 7) l1++;
  if (l2 > 7) l2++;
  return String.fromCharCode(65 + l1, 65 + l2);
}

const dirCache = new Map();
function findTileZip(e, n) {
  if (e < 0 || n < 0 || e >= 700_000 || n >= 1_300_000) return null;
  const letters = gridLetters(e, n).toLowerCase();
  const ref = `${letters}${Math.floor((e % 100_000) / TILE)}${Math.floor((n % 100_000) / TILE)}`;
  const dir = path.join(SOURCE, "data", letters);
  if (!dirCache.has(dir)) dirCache.set(dir, existsSync(dir) ? readdirSync(dir) : []);
  const file = dirCache.get(dir).find((f) => f.startsWith(`${ref}_`) && f.endsWith(".zip"));
  return file ? path.join(dir, file) : null;
}

function readTile(zip) {
  const text = execFileSync("unzip", ["-p", zip, "*.asc"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const lines = text.split(/\r?\n/);
  const header = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^([a-z_]+)\s+(-?[\d.]+)\s*$/i.exec(lines[i]);
    if (!m) break;
    header[m[1].toLowerCase()] = Number(m[2]);
  }
  const { ncols, nrows, xllcorner, yllcorner, cellsize } = header;
  if (cellsize !== SRC_CELL) throw new Error(`${zip}: unexpected cellsize ${cellsize}`);
  const nodata = header.nodata_value;
  const values = new Float32Array(ncols * nrows);
  let k = 0;
  for (; i < lines.length && k < values.length; i++) {
    for (const token of lines[i].trim().split(/\s+/)) {
      if (!token) continue;
      const v = Number(token);
      values[k++] = v === nodata ? NaN : v;
    }
  }
  return { ncols, nrows, xll: xllcorner, yll: yllcorner, values };
}

/**
 * Box-averages source cells into a target grid whose NW corner is
 * (west, north); columns run east, rows run south.
 */
function bake({ west, north, cols, rows, cell }) {
  const sum = new Float64Array(cols * rows);
  const count = new Uint32Array(cols * rows);
  const east = west + cols * cell;
  const south = north - rows * cell;
  let tiles = 0;
  for (let te = Math.floor(west / TILE) * TILE; te < east; te += TILE) {
    for (let tn = Math.floor(south / TILE) * TILE; tn < north; tn += TILE) {
      const zip = findTileZip(te, tn);
      if (!zip) continue;
      const t = readTile(zip);
      tiles++;
      for (let r = 0; r < t.nrows; r++) {
        const n = t.yll + (t.nrows - r - 0.5) * SRC_CELL;
        const row = Math.floor((north - n) / cell);
        if (row < 0 || row >= rows) continue;
        for (let c = 0; c < t.ncols; c++) {
          const e = t.xll + (c + 0.5) * SRC_CELL;
          const col = Math.floor((e - west) / cell);
          if (col < 0 || col >= cols) continue;
          const v = t.values[r * t.ncols + c];
          if (Number.isNaN(v)) continue;
          sum[row * cols + col] += v;
          count[row * cols + col]++;
        }
      }
    }
  }
  const data = new Int16Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  let missing = 0;
  for (let i = 0; i < data.length; i++) {
    if (!count[i]) {
      data[i] = NODATA;
      missing++;
      continue;
    }
    const m = sum[i] / count[i];
    data[i] = Math.max(-32767, Math.min(32767, Math.round(m * 10)));
    min = Math.min(min, m);
    max = Math.max(max, m);
  }
  return { data, min, max, tiles, missing };
}

function writeDataset(id, label, grid, landmarks, contour) {
  const result = bake(grid);
  if (result.tiles === 0) throw new Error(`${id}: no source tiles found in ${SOURCE}`);
  writeFileSync(path.join(OUT_BIN, `${id}.bin`), Buffer.from(result.data.buffer));
  console.log(
    `${id}: ${grid.cols}x${grid.rows} @ ${grid.cell} m from ${result.tiles} tiles, ` +
      `${result.min.toFixed(1)}..${result.max.toFixed(1)} m, ${result.missing} empty cells`,
  );
  return {
    id,
    label,
    file: `${id}.bin`,
    west: grid.west,
    north: grid.north,
    cols: grid.cols,
    rows: grid.rows,
    cell: grid.cell,
    minElevation: Math.round(result.min * 10) / 10,
    maxElevation: Math.round(result.max * 10) / 10,
    contour,
    landmarks: landmarks.map(([name, lat, lon, extra]) => ({
      name,
      ...en(lon, lat),
      ...(extra?.start && extra?.end
        ? { span: [en(extra.start[1], extra.start[0]), en(extra.end[1], extra.end[0])] }
        : {}),
    })),
  };
}

mkdirSync(OUT_BIN, { recursive: true });
mkdirSync(path.dirname(OUT_MANIFEST), { recursive: true });

const centre = en(CENTRE.lon, CENTRE.lat);

/** Grid covering a lat/lon bbox, edges snapped outwards to whole cells. */
function gridFor(bbox, cell) {
  const corners = [
    en(bbox.west, bbox.south),
    en(bbox.west, bbox.north),
    en(bbox.east, bbox.south),
    en(bbox.east, bbox.north),
  ];
  const west = Math.floor(Math.min(...corners.map((c) => c.e)) / cell) * cell;
  const east = Math.ceil(Math.max(...corners.map((c) => c.e)) / cell) * cell;
  const south = Math.floor(Math.min(...corners.map((c) => c.n)) / cell) * cell;
  const north = Math.ceil(Math.max(...corners.map((c) => c.n)) / cell) * cell;
  return { west, north, east, south, cols: (east - west) / cell, rows: (north - south) / cell, cell };
}

const bristolGrid = gridFor(BRISTOL_BBOX, SRC_CELL);
const bristol = writeDataset("bristol", "Bristol", bristolGrid, BRISTOL_LANDMARKS, {
  minor: 10,
  major: 50,
});

const avon = writeDataset("avon", "Avon", gridFor(AVON_BBOX, AVON_CELL), AVON_LANDMARKS, {
  minor: 20,
  major: 100,
});

const rw = Math.floor((centre.e - REGION_RADIUS) / REGION_CELL) * REGION_CELL;
const re = Math.ceil((centre.e + REGION_RADIUS) / REGION_CELL) * REGION_CELL;
const rs = Math.max(0, Math.floor((centre.n - REGION_RADIUS) / REGION_CELL) * REGION_CELL);
const rn = Math.ceil((centre.n + REGION_RADIUS) / REGION_CELL) * REGION_CELL;

const region = writeDataset(
  "region",
  "Region",
  { west: rw, north: rn, cols: (re - rw) / REGION_CELL, rows: (rn - rs) / REGION_CELL, cell: REGION_CELL },
  REGION_LANDMARKS,
  { minor: 50, major: 250 },
);

const manifest = {
  source: "OS Terrain 50 (ASCII grid), EPSG:27700",
  attribution: "Contains OS data © Crown copyright and database right 2026",
  centre: { ...centre, ...CENTRE },
  focus: {
    west: bristolGrid.west,
    north: bristolGrid.north,
    east: bristolGrid.east,
    south: bristolGrid.south,
  },
  datasets: [bristol, avon, region],
};
writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${path.relative(ROOT, OUT_MANIFEST)}`);
