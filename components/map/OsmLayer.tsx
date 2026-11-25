"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { sampleSurface, sceneScale, toScene, type Heightfield } from "@/lib/terrain/heightfield";
import { densify, insideDataset, type OsmClass, type OsmData } from "@/lib/terrain/osm";
import type { MapPalette } from "./palette";

/**
 * Area fills are channel encoded so colours live in the terrain shader and
 * theme or layer toggles never re-rasterise:
 *   natural: r water, g park, b wood (255) / open countryside (128)
 *   built:   r residential, g commercial, b industrial
 * Built-up areas are coarse, so their texture is half the resolution.
 */
const FILL_CHANNEL: Partial<Record<OsmClass, { texture: "natural" | "built"; style: string }>> = {
  water: { texture: "natural", style: "rgb(255,0,0)" },
  park: { texture: "natural", style: "rgb(0,255,0)" },
  wood: { texture: "natural", style: "rgb(0,0,255)" },
  open: { texture: "natural", style: "rgb(0,0,128)" },
  residential: { texture: "built", style: "rgb(255,0,0)" },
  commercial: { texture: "built", style: "rgb(0,255,0)" },
  industrial: { texture: "built", style: "rgb(0,0,255)" },
};

const TEXTURE_SIZE = { natural: 4096, built: 2048 } as const;

export type OsmTextures = { natural: THREE.Texture; built: THREE.Texture };

function rasterise(
  field: Heightfield,
  osm: OsmData,
  which: keyof typeof TEXTURE_SIZE,
): THREE.Texture | null {
  const widthM = field.cols * field.cell;
  const heightM = field.rows * field.cell;
  const scale = TEXTURE_SIZE[which] / Math.max(widthM, heightM);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthM * scale);
  canvas.height = Math.round(heightM * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Per-channel max, so overlapping classes keep their own channel.
  ctx.globalCompositeOperation = "lighten";
  for (const f of osm.features) {
    const channel = FILL_CHANNEL[osm.classes[f.cls]];
    if (!channel || channel.texture !== which || osm.kinds[f.cls] !== "fill") continue;
    ctx.fillStyle = channel.style;
    ctx.beginPath();
    for (const ring of f.rings) {
      for (let k = 0; k < ring.length; k += 2) {
        const x = (ring[k] - field.west) * scale;
        const y = (field.north - ring[k + 1]) * scale;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function useOsmTextures(field: Heightfield, osm: OsmData | null): OsmTextures | null {
  const textures = useMemo(() => {
    if (!osm || osm.dataset !== field.id) return null;
    const natural = rasterise(field, osm, "natural");
    const built = rasterise(field, osm, "built");
    return natural && built ? { natural, built } : null;
  }, [field, osm]);

  useEffect(
    () => () => {
      textures?.natural.dispose();
      textures?.built.dispose();
    },
    [textures],
  );
  return textures;
}

/** Draw order: water and paths under roads; bridges on top. */
const LINE_ORDER: OsmClass[] = [
  "stream",
  "river",
  "footpath",
  "bridleway",
  "road_minor",
  "cycleway",
  "rail",
  "road_secondary",
  "road_major",
  "bridge",
];

/** Segment endpoints per class at exaggeration 1; the group scales y. */
function buildSegments(field: Heightfield, osm: OsmData) {
  const s = sceneScale(field);
  const step = field.cell / 2;
  const byClass = new Map<number, number[]>();
  for (const f of osm.features) {
    if (osm.kinds[f.cls] !== "line") continue;
    let out = byClass.get(f.cls);
    if (!out) byClass.set(f.cls, (out = []));
    for (const ring of f.rings) {
      const pts = densify(ring, step);
      let prev: [number, number, number] | null = null;
      for (let k = 0; k < pts.length; k += 2) {
        const e = pts[k];
        const n = pts[k + 1];
        const h = insideDataset(field, e, n) ? sampleSurface(field, e, n) : NaN;
        if (Number.isNaN(h)) {
          prev = null;
          continue;
        }
        const p = toScene(field, e, n);
        const cur: [number, number, number] = [p.x, Math.max(h, 0) * s, p.z];
        if (prev) out.push(...prev, ...cur);
        prev = cur;
      }
    }
  }
  return byClass;
}

/** OSM lines draped on the terrain, with per-class width, colour and zoom fade. */
export function OsmLines({
  field,
  osm,
  enabled,
  exaggeration,
  palette,
}: {
  field: Heightfield;
  osm: OsmData;
  enabled: boolean[];
  exaggeration: number;
  palette: MapPalette;
}) {
  const size = useThree((st) => st.size);
  const get = useThree((st) => st.get);

  const layers = useMemo(() => {
    const segs = buildSegments(field, osm);
    return LINE_ORDER.flatMap((name, order) => {
      const cls = osm.classes.indexOf(name);
      const positions = segs.get(cls);
      if (cls < 0 || !positions?.length) return [];
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(positions);
      const material = new LineMaterial({
        transparent: true,
        depthWrite: false,
        // Pulls the ribbons toward the camera so they sit on, not in, the surface.
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4 - order,
      });
      const line = new LineSegments2(geometry, material);
      line.frustumCulled = false;
      line.renderOrder = 1 + order;
      line.raycast = () => {};
      return [{ cls, name, line, material }];
    });
  }, [field, osm]);

  useEffect(
    () => () =>
      layers.forEach((l) => {
        l.line.geometry.dispose();
        l.material.dispose();
      }),
    [layers],
  );

  const group = useRef<THREE.Group>(null);
  // Per-frame styling reads through a ref (React compiler disallows mutating
  // memoised values from callbacks).
  const state = useRef({ palette, enabled, size, exaggeration, layers });
  useEffect(() => {
    state.current = { palette, enabled, size, exaggeration, layers };
  }, [palette, enabled, size, exaggeration, layers]);

  useFrame(() => {
    const { palette: pal, enabled: on, size: sz, exaggeration: exag, layers: ls } = state.current;
    const g = group.current;
    if (g) g.scale.y = exag;
    const { camera, controls } = get();
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
    const d = target ? camera.position.distanceTo(target) : camera.position.length();
    // Lines thicken gently as you zoom in.
    const zoomWidth = THREE.MathUtils.clamp(3 / Math.max(d, 0.1), 0.55, 2.2);
    for (const l of ls) {
      const style = pal.lines[l.name];
      const alpha = style
        ? style.alpha * (1 - THREE.MathUtils.smoothstep(d, style.fade * 0.55, style.fade))
        : 0;
      // Three.js objects are mutated per frame by design.
      // eslint-disable-next-line react-hooks/immutability
      l.line.visible = !!on[l.cls] && alpha > 0.01;
      if (!l.line.visible || !style) continue;
      l.material.color.set(style.color);
      l.material.opacity = alpha;
      l.material.linewidth = style.width * zoomWidth;
      l.material.resolution.set(sz.width, sz.height);
    }
  });

  return (
    <group ref={group}>
      {layers.map((l) => (
        <primitive key={l.name} object={l.line} />
      ))}
    </group>
  );
}
