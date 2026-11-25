"use client";

import { Line } from "@react-three/drei";
import { useMemo } from "react";
import { sampleSurface, sceneScale, toScene, type Heightfield } from "@/lib/terrain/heightfield";
import { densify, insideDataset } from "@/lib/terrain/osm";

export type RouteLine = { id: string; color: string; points: number[] };

/** Scene-space polyline pieces draped on the exaggerated terrain. */
export function drapeRoute(
  field: Heightfield,
  points: number[],
  exaggeration: number,
): [number, number, number][][] {
  const vs = sceneScale(field) * exaggeration;
  // Heights come from the exact mesh triangles, so only the chord between
  // samples can dip under a facet; that error grows with exaggeration, so
  // the lift does too.
  const lift = 0.002 + 3 * vs;
  const dense = densify(Float64Array.from(points), field.cell / 3);
  const pieces: [number, number, number][][] = [];
  let run: [number, number, number][] = [];
  for (let k = 0; k < dense.length; k += 2) {
    const e = dense[k];
    const n = dense[k + 1];
    const h = insideDataset(field, e, n) ? sampleSurface(field, e, n) : NaN;
    if (Number.isNaN(h)) {
      if (run.length > 1) pieces.push(run);
      run = [];
      continue;
    }
    const p = toScene(field, e, n);
    run.push([p.x, h * vs + lift, p.z]);
  }
  if (run.length > 1) pieces.push(run);
  return pieces;
}

type Casing = { color: string; alpha: number };

function RoutePath({
  field,
  route,
  exaggeration,
  casing,
}: {
  field: Heightfield;
  route: RouteLine;
  exaggeration: number;
  casing: Casing;
}) {
  const pieces = useMemo(
    () => drapeRoute(field, route.points, exaggeration),
    [field, route.points, exaggeration],
  );
  return (
    <>
      {pieces.map((pts, i) => (
        <group key={`${route.id}:${i}`}>
          {/* Dark casing keeps the route readable over bright wireframe. Both lines
              are transparent so renderOrder keeps the colour on top. */}
          <Line
            points={pts}
            color={casing.color}
            lineWidth={5.5}
            transparent
            opacity={casing.alpha}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-16}
            renderOrder={3}
          />
          <Line
            points={pts}
            color={route.color}
            lineWidth={2.6}
            transparent
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-20}
            renderOrder={4}
          />
        </group>
      ))}
    </>
  );
}

export function RouteLayer({
  field,
  routes,
  exaggeration,
  casing,
}: {
  field: Heightfield;
  routes: RouteLine[];
  exaggeration: number;
  casing: Casing;
}) {
  return (
    <>
      {routes.map((r) => (
        <RoutePath key={r.id} field={field} route={r} exaggeration={exaggeration} casing={casing} />
      ))}
    </>
  );
}
