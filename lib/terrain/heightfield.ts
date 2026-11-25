import manifestJson from "./manifest.json";

/** Sentinel written by scripts/bake-terrain.mjs where no source tile exists (sea). */
export const NODATA = -32768;

export type GridPoint = { e: number; n: number };

/** span: end points for features that cross something (e.g. a bridge). */
export type Landmark = GridPoint & { name: string; span?: [GridPoint, GridPoint] };

/** Metadata for one baked heightfield, in British National Grid metres (EPSG:27700). */
export type TerrainDataset = {
  id: string;
  label: string;
  file: string;
  /** Easting of the western edge of the grid. */
  west: number;
  /** Northing of the northern edge of the grid. */
  north: number;
  cols: number;
  rows: number;
  /** Cell size in metres. */
  cell: number;
  minElevation: number;
  maxElevation: number;
  contour: { minor: number; major: number };
  landmarks: Landmark[];
};

export type TerrainManifest = {
  source: string;
  attribution: string;
  centre: { e: number; n: number; lat: number; lon: number };
  focus: { west: number; north: number; east: number; south: number };
  datasets: TerrainDataset[];
};

/** Elevations in metres, row 0 = north. Sea / missing cells are NaN. */
export type Heightfield = TerrainDataset & { elevation: Float32Array };

export const manifest = manifestJson as TerrainManifest;

export function decodeHeightfield(
  dataset: TerrainDataset,
  buffer: ArrayBuffer,
): Heightfield {
  const expected = dataset.cols * dataset.rows;
  if (buffer.byteLength !== expected * 2) {
    throw new Error(
      `Terrain file ${dataset.file} has ${buffer.byteLength} bytes, expected ${expected * 2}.`,
    );
  }
  const view = new DataView(buffer);
  const elevation = new Float32Array(expected);
  for (let i = 0; i < expected; i++) {
    const raw = view.getInt16(i * 2, true);
    elevation[i] = raw === NODATA ? NaN : raw / 10;
  }
  return { ...dataset, elevation };
}

/**
 * Bilinear elevation at a grid position (fractional column/row of cell
 * centres). Missing cells count as sea level; positions outside the grid
 * return NaN.
 */
export function sampleGrid(field: Heightfield, col: number, row: number): number {
  const { cols, rows, elevation } = field;
  if (col < 0 || row < 0 || col > cols - 1 || row > rows - 1) return NaN;
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(c0 + 1, cols - 1);
  const r1 = Math.min(r0 + 1, rows - 1);
  const fc = col - c0;
  const fr = row - r0;
  const at = (c: number, r: number) => {
    const v = elevation[r * cols + c];
    return Number.isNaN(v) ? 0 : v;
  };
  const top = at(c0, r0) * (1 - fc) + at(c1, r0) * fc;
  const bottom = at(c0, r1) * (1 - fc) + at(c1, r1) * fc;
  return top * (1 - fr) + bottom * fr;
}

/**
 * Elevation on the rendered mesh surface: each cell is split into triangles
 * (top-left, bottom-left, top-right) and (top-right, bottom-left,
 * bottom-right) exactly like the terrain index buffer. Bilinear sampling can
 * sit metres below a facet, which at high exaggeration buries draped lines.
 */
export function sampleSurface(field: Heightfield, e: number, n: number): number {
  const { cols, rows, elevation } = field;
  const { col, row } = gridPosition(field, e, n);
  if (col < 0 || row < 0 || col > cols - 1 || row > rows - 1) return NaN;
  const c0 = Math.min(Math.floor(col), cols - 2);
  const r0 = Math.min(Math.floor(row), rows - 2);
  const fc = col - c0;
  const fr = row - r0;
  const at = (c: number, r: number) => {
    const v = elevation[r * cols + c];
    return Number.isNaN(v) ? 0 : v;
  };
  const b = at(c0 + 1, r0);
  const d = at(c0, r0 + 1);
  if (fc + fr <= 1) {
    const a = at(c0, r0);
    return a + (b - a) * fc + (d - a) * fr;
  }
  const f = at(c0 + 1, r0 + 1);
  return f + (d - f) * (1 - fc) + (b - f) * (1 - fr);
}

/** Grid position (fractional column/row) for an easting/northing. */
export function gridPosition(field: TerrainDataset, e: number, n: number) {
  return {
    col: (e - field.west) / field.cell - 0.5,
    row: (field.north - n) / field.cell - 0.5,
  };
}

export function sampleElevation(field: Heightfield, e: number, n: number): number {
  const { col, row } = gridPosition(field, e, n);
  return sampleGrid(field, col, row);
}

/** True when the cell nearest the easting/northing has no source data (sea). */
export function isSea(field: Heightfield, e: number, n: number): boolean {
  const { col, row } = gridPosition(field, e, n);
  const c = Math.round(col);
  const r = Math.round(row);
  if (c < 0 || r < 0 || c >= field.cols || r >= field.rows) return false;
  return Number.isNaN(field.elevation[r * field.cols + c]);
}

/**
 * Scene coordinates: x east, y up, z south. The dataset is scaled so its
 * longest side spans SCENE_SIZE units, centred on the origin. Horizontal and
 * vertical scale are equal before exaggeration.
 */
export const SCENE_SIZE = 10;

export function sceneScale(field: TerrainDataset): number {
  return SCENE_SIZE / (Math.max(field.cols, field.rows) * field.cell);
}

export function datasetCentre(field: TerrainDataset) {
  return {
    e: field.west + (field.cols * field.cell) / 2,
    n: field.north - (field.rows * field.cell) / 2,
  };
}

export function toScene(field: TerrainDataset, e: number, n: number) {
  const s = sceneScale(field);
  const c = datasetCentre(field);
  return { x: (e - c.e) * s, z: -(n - c.n) * s };
}

export function fromScene(field: TerrainDataset, x: number, z: number) {
  const s = sceneScale(field);
  const c = datasetCentre(field);
  return { e: c.e + x / s, n: c.n - z / s };
}

/** OS National Grid reference, e.g. "ST 5871 7287" (digits per axis). */
export function formatGridRef(e: number, n: number, digits = 4): string {
  if (e < 0 || n < 0 || e >= 700_000 || n >= 1_300_000) return "";
  const e100 = Math.floor(e / 100_000);
  const n100 = Math.floor(n / 100_000);
  let l1 = 19 - n100 - ((19 - n100) % 5) + Math.floor((e100 + 10) / 5);
  let l2 = (((19 - n100) * 5) % 25) + (e100 % 5);
  if (l1 > 7) l1++;
  if (l2 > 7) l2++;
  const letters = String.fromCharCode(65 + l1, 65 + l2);
  const div = 10 ** (5 - digits);
  const pad = (v: number) =>
    String(Math.floor((v % 100_000) / div)).padStart(digits, "0");
  return `${letters} ${pad(e)} ${pad(n)}`;
}
