import {
  fromScene,
  sampleElevation,
  sceneScale,
  type Heightfield,
} from "./heightfield";

type Vec3 = { x: number; y: number; z: number };

export type TerrainPick = {
  e: number;
  n: number;
  elevation: number;
  point: Vec3;
};

/**
 * Intersects a scene-space ray with the exaggerated heightfield by marching
 * in half-cell steps and refining with bisection. Returns null on a miss.
 */
export function pickTerrain(
  field: Heightfield,
  exaggeration: number,
  origin: Vec3,
  dir: Vec3,
): TerrainPick | null {
  const s = sceneScale(field) * exaggeration;
  const top = Math.max(field.maxElevation, 0) * s + 1e-6;
  const bottom = Math.min(field.minElevation, 0) * s - 1e-6;
  if (dir.y >= 0 && origin.y > top) return null;

  const heightAt = (t: number) => {
    const x = origin.x + dir.x * t;
    const z = origin.z + dir.z * t;
    const { e, n } = fromScene(field, x, z);
    return { e, n, y: origin.y + dir.y * t, h: sampleElevation(field, e, n) };
  };

  const t0 = origin.y > top ? (top - origin.y) / dir.y : 0;
  const tEnd = dir.y < 0 ? (bottom - origin.y) / dir.y : t0 + 40;
  const step = field.cell * sceneScale(field) * 0.5;
  const maxSteps = 6000;

  let prev = t0;
  for (let i = 0, t = t0; t <= tEnd && i < maxSteps; i++, t += step) {
    const p = heightAt(t);
    if (!Number.isNaN(p.h) && p.y <= p.h * s) {
      let lo = prev;
      let hi = t;
      for (let j = 0; j < 12; j++) {
        const mid = (lo + hi) / 2;
        const m = heightAt(mid);
        if (!Number.isNaN(m.h) && m.y <= m.h * s) hi = mid;
        else lo = mid;
      }
      const hit = heightAt(hi);
      const elevation = Number.isNaN(hit.h) ? p.h : hit.h;
      return {
        e: hit.e,
        n: hit.n,
        elevation,
        point: {
          x: origin.x + dir.x * hi,
          y: elevation * s,
          z: origin.z + dir.z * hi,
        },
      };
    }
    prev = t;
  }
  return null;
}
