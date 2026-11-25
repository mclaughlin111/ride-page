"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { sceneScale, toScene, type Heightfield } from "@/lib/terrain/heightfield";
import type { FillClass } from "./palette";
import type { OsmTextures } from "./OsmLayer";
import type { MapPalette } from "./palette";
import { terrainFragmentShader, terrainVertexShader } from "./terrainShader";

type U<T> = { value: T };

export type TerrainUniforms = {
  uScale: U<number>;
  uExag: U<number>;
  uMin: U<number>;
  uMax: U<number>;
  uMinor: U<number>;
  uMajor: U<number>;
  uWire: U<number>;
  uContours: U<number>;
  uHover: U<number>;
  uHoverElev: U<number>;
  uDims: U<THREE.Vector2>;
  uBg: U<THREE.Color>;
  uFogNear: U<number>;
  uFogFar: U<number>;
  uHypso: U<THREE.Color[]>;
  uSlope: U<THREE.Color>;
  uShadow: U<THREE.Color>;
  uHighlight: U<THREE.Color>;
  uRelief: U<number>;
  uSeaColor: U<THREE.Color>;
  uWireLow: U<THREE.Color>;
  uWireHigh: U<THREE.Color>;
  uWireAlpha: U<number>;
  uContourMinor: U<THREE.Color>;
  uContourMajor: U<THREE.Color>;
  uContourAlpha: U<number>;
  uAccent: U<THREE.Color>;
  uOverlay: U<THREE.Texture | null>;
  uBuilt: U<THREE.Texture | null>;
  uOverlayOn: U<number>;
  uFillOn: U<THREE.Vector4>;
  uBuiltOn: U<THREE.Vector3>;
  uWaterFill: U<THREE.Vector4>;
  uParkFill: U<THREE.Vector4>;
  uWoodFill: U<THREE.Vector4>;
  uOpenFill: U<THREE.Vector4>;
  uResidentialFill: U<THREE.Vector4>;
  uCommercialFill: U<THREE.Vector4>;
  uIndustrialFill: U<THREE.Vector4>;
};

/**
 * One vertex per grid cell centre; elevation is applied in the vertex shader.
 * Slope and curvature are precomputed here so hillshade follows the real
 * terrain and stays correct at any exaggeration without rebuilding.
 */
export function buildTerrainGeometry(field: Heightfield): THREE.BufferGeometry {
  const { cols, rows, cell, west, north, elevation } = field;
  const count = cols * rows;
  const position = new Float32Array(count * 3);
  const elev = new Float32Array(count);
  const sea = new Float32Array(count);
  const grid = new Float32Array(count * 2);
  const grad = new Float32Array(count * 2);
  const curv = new Float32Array(count);
  const h = (c: number, r: number) => {
    const v = elevation[Math.min(Math.max(r, 0), rows - 1) * cols + Math.min(Math.max(c, 0), cols - 1)];
    return Number.isNaN(v) ? 0 : v;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const p = toScene(field, west + (c + 0.5) * cell, north - (r + 0.5) * cell);
      position[i * 3] = p.x;
      position[i * 3 + 2] = p.z;
      const v = elevation[i];
      elev[i] = Number.isNaN(v) ? 0 : v;
      // OS Terrain 50 has sea and tidal water at or below 0 m.
      sea[i] = Number.isNaN(v) || v <= 0 ? 1 : 0;
      grid[i * 2] = c;
      grid[i * 2 + 1] = r;
      grad[i * 2] = (h(c + 1, r) - h(c - 1, r)) / (2 * cell);
      grad[i * 2 + 1] = (h(c, r + 1) - h(c, r - 1)) / (2 * cell);
      const lap = h(c + 1, r) + h(c - 1, r) + h(c, r + 1) + h(c, r - 1) - 4 * h(c, r);
      curv[i] = (lap / cell) * 4;
    }
  }
  const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      index[k++] = a;
      index[k++] = d;
      index[k++] = b;
      index[k++] = b;
      index[k++] = d;
      index[k++] = e;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("aElev", new THREE.BufferAttribute(elev, 1));
  geometry.setAttribute("aSea", new THREE.BufferAttribute(sea, 1));
  geometry.setAttribute("aGrid", new THREE.BufferAttribute(grid, 2));
  geometry.setAttribute("aGrad", new THREE.BufferAttribute(grad, 2));
  geometry.setAttribute("aCurv", new THREE.BufferAttribute(curv, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  const s = sceneScale(field);
  const half = (Math.max(cols, rows) * cell * s) / 2;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), half * 1.5);
  return geometry;
}

/** Matches the packing of uFillOn (first four) and uBuiltOn (last three). */
const FILL_ORDER: FillClass[] = ["water", "park", "wood", "open", "residential", "commercial", "industrial"];

const fill = (f: { color: string; alpha: number }) => {
  const c = new THREE.Color(f.color);
  return new THREE.Vector4(c.r, c.g, c.b, f.alpha);
};

/** Writes a palette into the terrain uniforms; no geometry or material rebuild. */
export function applyPalette(u: TerrainUniforms, p: MapPalette) {
  u.uBg.value.set(p.background);
  p.hypso.forEach((c, i) => u.uHypso.value[i].set(c));
  u.uSlope.value.set(p.slope);
  u.uShadow.value.set(p.shadow);
  u.uHighlight.value.set(p.highlight);
  u.uRelief.value = p.relief;
  u.uSeaColor.value.set(p.sea);
  u.uWireLow.value.set(p.wireLow);
  u.uWireHigh.value.set(p.wireHigh);
  u.uWireAlpha.value = p.wireAlpha;
  u.uContourMinor.value.set(p.contourMinor);
  u.uContourMajor.value.set(p.contourMajor);
  u.uContourAlpha.value = p.contourAlpha;
  u.uAccent.value.set(p.accent);
  u.uWaterFill.value.copy(fill(p.fills.water));
  u.uParkFill.value.copy(fill(p.fills.park));
  u.uWoodFill.value.copy(fill(p.fills.wood));
  u.uOpenFill.value.copy(fill(p.fills.open));
  u.uResidentialFill.value.copy(fill(p.fills.residential));
  u.uCommercialFill.value.copy(fill(p.fills.commercial));
  u.uIndustrialFill.value.copy(fill(p.fills.industrial));
}

export function TerrainMesh({
  field,
  exaggeration,
  wireframe,
  contours,
  overlay,
  fillsOn,
  palette,
  uniformsRef,
}: {
  field: Heightfield;
  exaggeration: number;
  wireframe: boolean;
  contours: boolean;
  overlay: OsmTextures | null;
  fillsOn: Record<FillClass, boolean>;
  palette: MapPalette;
  uniformsRef: React.RefObject<TerrainUniforms | null>;
}) {
  const geometry = useMemo(() => buildTerrainGeometry(field), [field]);
  const material = useMemo(() => {
    const color = () => new THREE.Color();
    const uniforms: TerrainUniforms = {
      uScale: { value: 1 },
      uExag: { value: 1 },
      uMin: { value: 0 },
      uMax: { value: 1 },
      uMinor: { value: 10 },
      uMajor: { value: 50 },
      uWire: { value: 1 },
      uContours: { value: 1 },
      uHover: { value: 0 },
      uHoverElev: { value: 0 },
      uDims: { value: new THREE.Vector2(1, 1) },
      uBg: { value: color() },
      uFogNear: { value: 14 },
      uFogFar: { value: 34 },
      uHypso: { value: Array.from({ length: 5 }, color) },
      uSlope: { value: color() },
      uShadow: { value: color() },
      uHighlight: { value: color() },
      uRelief: { value: 1 },
      uSeaColor: { value: color() },
      uWireLow: { value: color() },
      uWireHigh: { value: color() },
      uWireAlpha: { value: 0.5 },
      uContourMinor: { value: color() },
      uContourMajor: { value: color() },
      uContourAlpha: { value: 0.6 },
      uAccent: { value: color() },
      uOverlay: { value: null },
      uBuilt: { value: null },
      uOverlayOn: { value: 0 },
      uFillOn: { value: new THREE.Vector4(1, 1, 1, 1) },
      uBuiltOn: { value: new THREE.Vector3(1, 1, 1) },
      uWaterFill: { value: new THREE.Vector4() },
      uParkFill: { value: new THREE.Vector4() },
      uWoodFill: { value: new THREE.Vector4() },
      uOpenFill: { value: new THREE.Vector4() },
      uResidentialFill: { value: new THREE.Vector4() },
      uCommercialFill: { value: new THREE.Vector4() },
      uIndustrialFill: { value: new THREE.Vector4() },
    };
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: terrainVertexShader,
      fragmentShader: terrainFragmentShader,
    });
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    uniformsRef.current = material.uniforms as unknown as TerrainUniforms;
    return () => {
      uniformsRef.current = null;
    };
  }, [material, uniformsRef]);

  // Uniforms are mutated through the ref so React's compiler rules allow it.
  useEffect(() => {
    const u = uniformsRef.current;
    if (!u) return;
    u.uScale.value = sceneScale(field);
    u.uMin.value = field.minElevation;
    u.uMax.value = field.maxElevation;
    u.uMinor.value = field.contour.minor;
    u.uMajor.value = field.contour.major;
    u.uDims.value.set(field.cols, field.rows);
  }, [material, field, uniformsRef]);

  useEffect(() => {
    const u = uniformsRef.current;
    if (u) applyPalette(u, palette);
  }, [material, palette, uniformsRef]);

  const fillKey = FILL_ORDER.map((k) => Number(fillsOn[k])).join("");
  useEffect(() => {
    const u = uniformsRef.current;
    if (!u) return;
    u.uExag.value = exaggeration;
    u.uWire.value = wireframe ? 1 : 0;
    u.uContours.value = contours ? 1 : 0;
    const f = fillKey.split("").map(Number);
    u.uFillOn.value.set(f[0], f[1], f[2], f[3]);
    u.uBuiltOn.value.set(f[4], f[5], f[6]);
  }, [material, exaggeration, wireframe, contours, fillKey, uniformsRef]);

  useEffect(() => {
    const u = uniformsRef.current;
    if (!u) return;
    u.uOverlay.value = overlay?.natural ?? null;
    u.uBuilt.value = overlay?.built ?? null;
    u.uOverlayOn.value = overlay ? 1 : 0;
  }, [material, overlay, uniformsRef]);

  // Picking is done by ray-marching the heightfield (see TerrainScene), which
  // is far cheaper than raycasting every triangle.
  return (
    <mesh geometry={geometry} material={material} raycast={() => null} frustumCulled={false} />
  );
}
