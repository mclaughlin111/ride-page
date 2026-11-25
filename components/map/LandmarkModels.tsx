"use client";

import { Detailed } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import type { MapPalette } from "./palette";
import * as THREE from "three";
import {
  sampleElevation,
  sceneScale,
  toScene,
  type Heightfield,
  type Landmark,
} from "@/lib/terrain/heightfield";

// Shared unit geometries and materials: every model is assembled from scaled
// instances of these, so adding landmarks costs no new GPU buffers.
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 6),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  disc: new THREE.CylinderGeometry(1, 1, 1, 10),
  dome: new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
  ball: new THREE.IcosahedronGeometry(1, 0),
  icon: new THREE.OctahedronGeometry(1, 0),
};

const MAT = {
  stone: new THREE.MeshStandardMaterial({ color: "#9a9ea3", roughness: 0.85, flatShading: true }),
  dark: new THREE.MeshStandardMaterial({ color: "#55595e", roughness: 0.9, flatShading: true }),
  roof: new THREE.MeshStandardMaterial({ color: "#6f7378", roughness: 0.9, flatShading: true }),
  land: new THREE.MeshStandardMaterial({ color: "#5d655f", roughness: 1, flatShading: true }),
  water: new THREE.MeshStandardMaterial({ color: "#4e6c7c", roughness: 0.35, flatShading: true }),
  accent: new THREE.MeshStandardMaterial({
    color: "#5cd6db",
    emissive: "#2b8c90",
    emissiveIntensity: 0.6,
    flatShading: true,
  }),
  icon: new THREE.MeshBasicMaterial({ color: "#d9dcdf" }),
  iconMajor: new THREE.MeshBasicMaterial({ color: "#5cd6db" }),
  cable: new THREE.LineBasicMaterial({ color: "#c9cdd1" }),
};

/** Recolours the shared materials in place, so a theme switch rebuilds nothing. */
function applyModelPalette(p: MapPalette["models"]) {
  MAT.stone.color.set(p.stone);
  MAT.dark.color.set(p.dark);
  MAT.roof.color.set(p.roof);
  MAT.land.color.set(p.land);
  MAT.water.color.set(p.water);
  MAT.accent.color.set(p.accent);
  MAT.accent.emissive.set(p.accent).multiplyScalar(0.35);
  MAT.icon.color.set(p.icon);
  MAT.iconMajor.color.set(p.accent);
  MAT.cable.color.set(p.cable);
}

type V3 = [number, number, number];

/** A scaled shared-geometry mesh, positioned by its base centre (y = bottom). */
function Part({
  g,
  m = "stone",
  p = [0, 0, 0],
  s,
  r = 0,
}: {
  g: keyof typeof GEO;
  m?: keyof typeof MAT;
  p?: V3;
  s: V3;
  r?: number;
}) {
  return (
    <mesh
      geometry={GEO[g]}
      material={MAT[m] as THREE.Material}
      position={[p[0], p[1] + (g === "dome" ? 0 : s[1] / 2), p[2]]}
      scale={s}
      rotation-y={r}
      raycast={() => null}
    />
  );
}

function Tree({ p, h = 14 }: { p: V3; h?: number }) {
  return <Part g="cone" m="land" p={p} s={[h * 0.35, h, h * 0.35]} />;
}

function Houses({ count, radius, arc, h }: { count: number; radius: number; arc: number; h: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const a = -arc / 2 + (arc * i) / Math.max(count - 1, 1);
        return (
          <group key={i} position={[Math.sin(a) * radius, 0, -Math.cos(a) * radius + radius]} rotation-y={-a}>
            <Part g="box" p={[0, 0, 0]} s={[radius * 0.16, h, 12]} />
            <Part g="cone4" m="roof" p={[0, h, 0]} s={[radius * 0.11, 6, 9]} r={Math.PI / 4} />
          </group>
        );
      })}
    </>
  );
}

function Hill({ w, h, d = w, peak = "flag" }: { w: number; h: number; d?: number; peak?: "flag" | "church" }) {
  return (
    <>
      <Part g="cone" m="land" s={[w, h, d]} />
      <Part g="cone" m="dark" s={[w * 0.55, h * 0.7, d * 0.55]} p={[w * 0.45, 0, d * 0.2]} />
      {peak === "flag" ? (
        <>
          <Part g="cyl" m="stone" p={[0, h * 0.94, 0]} s={[1.2, 26, 1.2]} />
          <Part g="box" m="accent" p={[6, h * 0.94 + 18, 0]} s={[12, 7, 1]} />
        </>
      ) : (
        <>
          {/* St Michael's, Dundry: tall tower visible across Bristol. */}
          <Part g="box" p={[0, h * 0.92, 0]} s={[10, 30, 10]} />
          <Part g="box" m="accent" p={[0, h * 0.92 + 30, 0]} s={[11, 3, 11]} />
          <Part g="box" m="roof" p={[-14, h * 0.9, 0]} s={[22, 12, 12]} />
        </>
      )}
    </>
  );
}

/** Builds the bridge from its real abutments so it spans the gorge at any exaggeration. */
function SuspensionBridge({
  span,
  deckY,
  sc,
}: {
  span: { x: number; z: number }[];
  deckY: number;
  sc: number;
}) {
  const geom = useMemo(() => {
    const [a, b] = span;
    const length = Math.hypot(b.x - a.x, b.z - a.z) / sc;
    const angle = Math.atan2(-(b.z - a.z), b.x - a.x);
    const towerH = 26 * 2;
    const half = length / 2 - 8;
    const pts: THREE.Vector3[] = [];
    // Two catenary cables (one each side) plus vertical hangers.
    for (const side of [-6, 6]) {
      const steps = 24;
      let prev: THREE.Vector3 | null = null;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = -half + t * half * 2;
        const y = 4 + (towerH - 6) * (2 * t - 1) ** 2;
        const p = new THREE.Vector3(x, y, side);
        if (prev) pts.push(prev, p);
        if (i % 2 === 0 && i > 0 && i < steps) pts.push(new THREE.Vector3(x, 2, side), p);
        prev = p;
      }
    }
    const lines = new THREE.BufferGeometry().setFromPoints(pts);
    return { length, angle, towerH, half, lines, mid: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 } };
  }, [span, sc]);

  const { length, angle, towerH, half, lines, mid } = geom;
  return (
    <group position={[mid.x, deckY, mid.z]} rotation-y={angle} scale={sc}>
      <Part g="box" m="dark" p={[0, 0, 0]} s={[length, 3, 10]} />
      {[-half, half].map((x) => (
        <group key={x} position={[x, -towerH * 0.6, 0]}>
          <Part g="box" p={[0, 0, -6]} s={[6, towerH * 1.6, 4]} />
          <Part g="box" p={[0, 0, 6]} s={[6, towerH * 1.6, 4]} />
          <Part g="box" p={[0, towerH * 1.45, 0]} s={[7, 6, 16]} />
          <Part g="box" m="accent" p={[0, towerH * 1.6, 0]} s={[7.5, 1.5, 16.5]} />
        </group>
      ))}
      <lineSegments geometry={lines} material={MAT.cable} raycast={() => null} />
    </group>
  );
}

type ModelKind =
  | "bridge"
  | "lake"
  | "dundry"
  | "belmont"
  | "parkStreet"
  | "constitution"
  | "clifton"
  | "ashton"
  | "harbour"
  | "gorge"
  | "observatory";

/**
 * terrain: miniature landscapes, stretched vertically with the terrain
 * exaggeration. Structures keep true proportions and are only positioned
 * with it.
 */
const MODELS: Record<string, { kind: ModelKind; major: boolean; terrain?: boolean }> = {
  "Clifton Suspension Bridge": { kind: "bridge", major: true },
  "Chew Valley Lake": { kind: "lake", major: true, terrain: true },
  "Dundry Hill": { kind: "dundry", major: true, terrain: true },
  "Belmont Hill": { kind: "belmont", major: false, terrain: true },
  "Park Street": { kind: "parkStreet", major: false },
  "Constitution Hill": { kind: "constitution", major: false, terrain: true },
  Clifton: { kind: "clifton", major: false },
  "Ashton Court": { kind: "ashton", major: true },
  Harbourside: { kind: "harbour", major: true },
  "Avon Gorge": { kind: "gorge", major: true, terrain: true },
  "Clifton Down": { kind: "observatory", major: false },
};

/** Full model, in metres with y up from the local ground. */
function FullModel({ kind }: { kind: ModelKind }) {
  switch (kind) {
    case "lake":
      return (
        // The lake itself comes from OpenStreetMap; the model adds sailing
        // dinghies and the valve tower by the north dam.
        <>
          {[
            [-40, 20, 0.4],
            [30, -30, -0.3],
            [70, 40, 0.9],
          ].map(([x, z, r]) => (
            <group key={x} position={[x, 0, z]} rotation-y={r}>
              <Part g="box" m="dark" s={[14, 3, 5]} />
              <Part g="cone4" m="stone" p={[1, 3, 0]} s={[5, 20, 1.5]} />
            </group>
          ))}
          <Part g="cyl" m="stone" p={[0, 0, -120]} s={[7, 22, 7]} />
          <Part g="cone" m="accent" p={[0, 22, -120]} s={[8, 6, 8]} />
        </>
      );
    case "dundry":
      return <Hill w={150} h={45} d={90} peak="church" />;
    case "belmont":
      return (
        <>
          <Hill w={120} h={40} d={90} />
          {/* Switchback road climbing the flank. */}
          {[0, 1, 2].map((i) => (
            <Part
              key={i}
              g="box"
              m="accent"
              p={[-70 + i * 22, 10 + i * 16, 40 - i * 14]}
              s={[90 - i * 20, 2, 6]}
              r={i % 2 ? 0.5 : -0.5}
            />
          ))}
        </>
      );
    case "parkStreet":
      return (
        <>
          {Array.from({ length: 7 }, (_, i) => (
            <group key={i}>
              <Part g="box" p={[-18, i * 7, 40 - i * 16]} s={[16, 22, 14]} />
              <Part g="box" m="roof" p={[18, i * 7, 40 - i * 16]} s={[16, 20, 14]} />
            </group>
          ))}
          <Part g="box" m="dark" p={[0, 0, -20]} s={[8, 2, 130]} />
          {/* Wills Memorial Building tower at the top of the street. */}
          <Part g="box" p={[0, 44, -78]} s={[18, 70, 18]} />
          <Part g="box" p={[0, 114, -78]} s={[13, 14, 13]} />
          <Part g="cyl" m="accent" p={[0, 128, -78]} s={[5, 6, 5]} />
        </>
      );
    case "constitution":
      return (
        <>
          {/* A steep wedge of terrain with the climb marked by chevrons. */}
          {[0, 1, 2, 3].map((i) => (
            <Part key={i} g="box" m={i % 2 ? "dark" : "land"} p={[0, 0, 30 - i * 20]} s={[36, 8 + i * 9, 20]} />
          ))}
          {[0, 1, 2].map((i) => (
            <Part key={i} g="cone4" m="accent" p={[0, 14 + i * 9, 26 - i * 20]} s={[5, 6, 5]} r={Math.PI / 4} />
          ))}
        </>
      );
    case "clifton":
      return (
        <>
          <Houses count={9} radius={110} arc={1.6} h={22} />
          <Part g="box" m="dark" p={[0, 0, 30]} s={[180, 3, 20]} />
        </>
      );
    case "ashton":
      return (
        <>
          <Part g="box" p={[0, 0, 0]} s={[90, 24, 30]} />
          <Part g="box" m="roof" p={[0, 24, 0]} s={[92, 6, 32]} />
          <Part g="box" p={[-50, 0, 0]} s={[14, 40, 14]} />
          <Tree p={[70, 0, 50]} h={30} />
          <Tree p={[95, 0, 20]} h={24} />
          <Tree p={[-80, 0, 60]} h={34} />
          {/* A balloon from the Bristol Balloon Fiesta. */}
          <Part g="ball" m="stone" p={[40, 70, -30]} s={[10, 12, 10]} />
          <Part g="box" m="accent" p={[40, 54, -30]} s={[3, 3, 3]} />
        </>
      );
    case "harbour":
      return (
        <>
          <Part g="box" m="water" p={[0, 0, 0]} s={[200, 2, 60]} />
          {[-60, -30, 0, 30].map((x) => (
            <group key={x} position={[x, 0, -45]}>
              <Part g="box" m="dark" s={[6, 40, 6]} />
              <Part g="box" m="stone" p={[8, 38, 0]} s={[30, 4, 4]} r={0} />
            </group>
          ))}
          {/* SS Great Britain hull with masts. */}
          <group position={[60, 2, 5]}>
            <Part g="box" m="dark" s={[80, 10, 14]} />
            {[-22, 0, 22].map((x) => (
              <Part key={x} g="cyl" m="stone" p={[x, 10, 0]} s={[1, 46, 1]} />
            ))}
            <Part g="box" m="accent" p={[0, 10, 0]} s={[60, 1.2, 15]} />
          </group>
        </>
      );
    case "gorge":
      return (
        <>
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 70, 0, 0]}>
              {Array.from({ length: 5 }, (_, i) => (
                <Part
                  key={i}
                  g="box"
                  m={i % 2 ? "stone" : "dark"}
                  p={[side * (i % 2) * 8, 0, -100 + i * 50]}
                  s={[40, 70 + ((i * 37) % 30), 50]}
                />
              ))}
            </group>
          ))}
          <Part g="box" m="water" p={[0, 0, 0]} s={[40, 3, 260]} />
        </>
      );
    case "observatory":
      return (
        <>
          <Part g="cyl" p={[0, 0, 0]} s={[12, 34, 12]} />
          <Part g="dome" m="accent" p={[0, 34, 0]} s={[12, 9, 12]} />
          <Part g="box" m="roof" p={[22, 0, 0]} s={[24, 14, 16]} />
        </>
      );
    default:
      return null;
  }
}

/** Medium-distance silhouette: a single block or mound. */
function SimpleModel({ kind }: { kind: ModelKind }) {
  if (kind === "lake")
    return (
      <>
        <Part g="box" m="dark" s={[20, 4, 7]} />
        <Part g="cone4" m="stone" p={[1, 4, 0]} s={[7, 28, 2]} />
      </>
    );
  if (kind === "dundry" || kind === "belmont" || kind === "gorge" || kind === "constitution")
    return (
      <>
        <Part g="cone" m="land" s={[110, 45, 80]} />
        <Part g="box" m="accent" p={[0, 42, 0]} s={[6, 6, 6]} />
      </>
    );
  if (kind === "parkStreet") return <Part g="box" p={[0, 0, -60]} s={[18, 110, 18]} />;
  return (
    <>
      <Part g="box" s={[50, 22, 26]} />
      <Part g="box" m="accent" p={[0, 22, 0]} s={[6, 6, 6]} />
    </>
  );
}

/** Screen-sized diamond for distant views. */
function Icon({ major }: { major: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const world = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.getWorldPosition(world);
    const parentScale = mesh.parent?.getWorldScale(new THREE.Vector3()).x ?? 1;
    mesh.scale.setScalar((camera.position.distanceTo(world) * 0.007) / parentScale);
  });
  return (
    <mesh
      ref={ref}
      geometry={GEO.icon}
      material={major ? MAT.iconMajor : MAT.icon}
      position-y={0}
      scale={[1, 1.6, 1]}
      raycast={() => null}
    />
  );
}

type Level = ReactElement<THREE.Object3D>;

/** Model sizes are world metres, enlarged for legibility at city scale. */
const MODEL_SCALE = 1.8;

function LandmarkModel({
  landmark,
  field,
  exaggeration,
}: {
  landmark: Landmark;
  field: Heightfield;
  exaggeration: number;
}) {
  const spec = MODELS[landmark.name];
  const s = sceneScale(field);
  const vs = s * exaggeration;
  const ground = (e: number, n: number) => {
    const h = sampleElevation(field, e, n);
    return Number.isNaN(h) ? 0 : Math.max(h, 0) * vs;
  };
  const p = toScene(field, landmark.e, landmark.n);
  const y = ground(landmark.e, landmark.n);
  const sc = s * MODEL_SCALE;
  const scale: [number, number, number] = spec.terrain
    ? [sc, sc * Math.max(exaggeration / 2, 1), sc]
    : [sc, sc, sc];
  // drei <Detailed> switches children by camera distance (scene units).
  const far = spec.major ? 40 : 9;
  let full = (
    <group scale={scale}>
      <FullModel kind={spec.kind} />
    </group>
  ) as Level;
  let simple = (
    <group scale={scale}>
      <SimpleModel kind={spec.kind} />
    </group>
  ) as Level;
  if (spec.kind === "bridge" && landmark.span) {
    const [a, b] = landmark.span;
    const span = [toScene(field, a.e, a.n), toScene(field, b.e, b.n)];
    const deckY = Math.max(ground(a.e, a.n), ground(b.e, b.n)) - y;
    full = (
      <SuspensionBridge
        span={span.map((q) => ({ x: q.x - p.x, z: q.z - p.z }))}
        deckY={deckY}
        sc={s}
      />
    ) as Level;
    simple = full;
  }
  return (
    <group position={[p.x, y, p.z]}>
      <Detailed distances={[0, 1.4, 3.2, far]}>
        {full}
        {simple}
        <Icon major={spec.major} />
        <group />
      </Detailed>
    </group>
  );
}

export function LandmarkModels({
  field,
  exaggeration,
  palette,
}: {
  field: Heightfield;
  exaggeration: number;
  palette: MapPalette;
}) {
  const m = palette.models;
  useEffect(() => applyModelPalette(m), [m]);
  const landmarks = field.landmarks.filter((l) => MODELS[l.name]);
  if (!landmarks.length) return null;
  return (
    <>
      <hemisphereLight args={[m.sky, m.ground, 1]} />
      <directionalLight position={[-4, 8, -5]} intensity={m.lightIntensity} />
      {landmarks.map((l) => (
        <LandmarkModel key={l.name} landmark={l} field={field} exaggeration={exaggeration} />
      ))}
    </>
  );
}
