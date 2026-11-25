import osmJson from "./osm.json";
import type { TerrainDataset } from "./heightfield";

export type OsmClass =
  | "residential"
  | "commercial"
  | "industrial"
  | "open"
  | "park"
  | "wood"
  | "water"
  | "stream"
  | "river"
  | "footpath"
  | "bridleway"
  | "cycleway"
  | "road_minor"
  | "road_secondary"
  | "road_major"
  | "rail"
  | "bridge";

/** One baked overlay file, covering the terrain dataset of the same id. */
export type OsmOverlay = {
  dataset: string;
  file: string;
  origin: { e: number; n: number };
};

export type OsmManifest = {
  source: string;
  attribution: string;
  classes: OsmClass[];
  kinds: ("fill" | "line")[];
  overlays: OsmOverlay[];
};

/** Everything needed to decode and draw one overlay. */
export type OsmMeta = OsmOverlay & Pick<OsmManifest, "source" | "attribution" | "classes" | "kinds">;

/** A feature with rings as flat [e0, n0, e1, n1, ...] British National Grid metres. */
export type OsmFeature = { cls: number; rings: Float64Array[] };

export type OsmData = OsmMeta & { features: OsmFeature[] };

export const osmManifest = osmJson as OsmManifest;

/** Overlay metadata for a terrain dataset, or null when it has no OSM layers. */
export function osmMetaFor(datasetId: string): OsmMeta | null {
  const overlay = osmManifest.overlays.find((o) => o.dataset === datasetId);
  if (!overlay) return null;
  const { source, attribution, classes, kinds } = osmManifest;
  return { ...overlay, source, attribution, classes, kinds };
}

/**
 * Layer toggles shown in the UI and the classes each one controls. Network
 * layers are plain toggles; area layers are grouped as wilderness or
 * built-up so each group can be switched as a whole or class by class.
 */
export const OSM_LAYERS = [
  { id: "roads", label: "Roads", group: "network", classes: ["road_major", "road_secondary", "road_minor", "bridge"] },
  { id: "paths", label: "Paths", group: "network", classes: ["cycleway", "footpath", "bridleway"] },
  { id: "rail", label: "Rail", group: "network", classes: ["rail"] },
  { id: "water", label: "Water", group: "network", classes: ["water", "river", "stream"] },
  { id: "wood", label: "Woodland", group: "wilderness", classes: ["wood"] },
  { id: "park", label: "Parks", group: "wilderness", classes: ["park"] },
  { id: "open", label: "Countryside", group: "wilderness", classes: ["open"] },
  { id: "residential", label: "Residential", group: "built", classes: ["residential"] },
  { id: "commercial", label: "Commercial", group: "built", classes: ["commercial"] },
  { id: "industrial", label: "Industry", group: "built", classes: ["industrial"] },
] as const satisfies readonly {
  id: string;
  label: string;
  group: "network" | "wilderness" | "built";
  classes: readonly OsmClass[];
}[];

export const OSM_GROUPS = [
  { id: "wilderness", label: "Wilderness" },
  { id: "built", label: "Built-up" },
] as const;

export type OsmLayerId = (typeof OSM_LAYERS)[number]["id"];

export function decodeOsm(meta: OsmMeta, buffer: ArrayBuffer): OsmData {
  const data = new Int16Array(buffer);
  const features: OsmFeature[] = [];
  const { e: oe, n: on } = meta.origin;
  let i = 0;
  while (i < data.length) {
    const cls = data[i++];
    const ringCount = data[i++];
    if (cls < 0 || cls >= meta.classes.length || ringCount < 1) {
      throw new Error("Map overlay file is corrupt.");
    }
    const rings: Float64Array[] = [];
    for (let r = 0; r < ringCount; r++) {
      const count = data[i++];
      if (i + count * 2 > data.length) throw new Error("Map overlay file is truncated.");
      const ring = new Float64Array(count * 2);
      for (let k = 0; k < count; k++) {
        ring[k * 2] = data[i++] + oe;
        ring[k * 2 + 1] = data[i++] + on;
      }
      rings.push(ring);
    }
    features.push({ cls, rings });
  }
  return { ...meta, features };
}

export function enabledClasses(
  meta: Pick<OsmManifest, "classes">,
  layers: Record<OsmLayerId, boolean>,
): boolean[] {
  return meta.classes.map((cls) =>
    OSM_LAYERS.some((l) => layers[l.id] && (l.classes as readonly OsmClass[]).includes(cls)),
  );
}

/** Splits each segment so no piece is longer than maxStep metres. */
export function densify(ring: Float64Array, maxStep: number): Float64Array {
  const out: number[] = [];
  for (let k = 0; k < ring.length / 2 - 1; k++) {
    const e0 = ring[k * 2];
    const n0 = ring[k * 2 + 1];
    const e1 = ring[k * 2 + 2];
    const n1 = ring[k * 2 + 3];
    const steps = Math.max(1, Math.ceil(Math.hypot(e1 - e0, n1 - n0) / maxStep));
    for (let s = 0; s < steps; s++) {
      out.push(e0 + ((e1 - e0) * s) / steps, n0 + ((n1 - n0) * s) / steps);
    }
  }
  if (ring.length >= 2) out.push(ring[ring.length - 2], ring[ring.length - 1]);
  return Float64Array.from(out);
}

export function insideDataset(field: TerrainDataset, e: number, n: number): boolean {
  return (
    e >= field.west &&
    e <= field.west + field.cols * field.cell &&
    n <= field.north &&
    n >= field.north - field.rows * field.cell
  );
}
