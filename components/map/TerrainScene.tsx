"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  manifest,
  sampleElevation,
  sceneScale,
  toScene,
  type Heightfield,
} from "@/lib/terrain/heightfield";
import type { OsmData } from "@/lib/terrain/osm";
import { pickTerrain } from "@/lib/terrain/picking";
import { LandmarkModels } from "./LandmarkModels";
import { OsmLines, useOsmTextures } from "./OsmLayer";
import { RouteLayer, type RouteLine } from "./RouteLayer";
import { headingStore, hoverStore, labelElements } from "./mapStore";
import type { FillClass, MapPalette } from "./palette";
import { TerrainMesh, type TerrainUniforms } from "./TerrainMesh";

export type MapMode = "plan" | "3d";

export type TerrainSceneProps = {
  field: Heightfield;
  mode: MapMode;
  exaggeration: number;
  wireframe: boolean;
  contours: boolean;
  labels: boolean;
  models: boolean;
  resetToken: number;
  /** Slow continuous orbit; pauses while the user interacts. */
  autoRotate: boolean;
  osm: OsmData | null;
  /** Per OSM class: shown or hidden. */
  osmEnabled: boolean[];
  palette: MapPalette;
  routes: RouteLine[];
};

const PAN_LIMIT = 6;
const FOV = 38;
const TRANSITION_MS = 750;
/** About one revolution every three minutes twenty seconds. */
const AUTO_ROTATE_SPEED = (Math.PI * 2) / 200;
/** Quiet time after interacting (or a reset) before rotation eases back in. */
const AUTO_ROTATE_HOLD_MS = 1800;

function cameraOffset(mode: MapMode, distance: number) {
  return mode === "plan"
    ? new THREE.Vector3(0, distance, 0.0001)
    : new THREE.Vector3(0, distance * 0.6, distance * 0.8);
}

/** Camera distance that fits the whole area on screen for the current aspect. */
function defaultDistance(mode: MapMode, camera: THREE.Camera, size: { w: number; d: number }) {
  const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1;
  const half = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const fit = Math.max(size.d / 2 / half, size.w / 2 / (half * aspect)) * 1.06;
  // A tilted view foreshortens depth, so it can sit a little closer.
  return Math.min(mode === "plan" ? fit : fit * 0.9, 22);
}

function applyConstraints(controls: OrbitControlsImpl, mode: MapMode) {
  controls.minDistance = 0.6;
  controls.maxDistance = 24;
  controls.screenSpacePanning = true;
  if (mode === "plan") {
    controls.enableRotate = false;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = 0;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.touches.ONE = THREE.TOUCH.PAN;
  } else {
    controls.enableRotate = true;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = 1.32;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  }
}

function CameraRig({
  mode,
  field,
  resetToken,
  autoRotate,
}: {
  mode: MapMode;
  field: Heightfield;
  resetToken: number;
  autoRotate: boolean;
}) {
  const fieldId = field.id;
  const s = sceneScale(field);
  const extent = useMemo(
    () => ({ w: field.cols * field.cell * s, d: field.rows * field.cell * s }),
    [field, s],
  );
  // Read camera/controls via get() so they are mutated outside render values.
  const get = useThree((s) => s.get);
  const controlsReady = useThree((s) => s.controls != null);
  const anim = useRef<{
    from: THREE.Spherical;
    to: THREE.Spherical;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
    mode: MapMode;
  } | null>(null);
  const last = useRef<{ mode: MapMode; fieldId: string; resetToken: number } | null>(
    null,
  );
  const spin = useRef({ enabled: autoRotate, speed: 0, interacting: false, holdUntil: 0 });
  useEffect(() => {
    spin.current.enabled = autoRotate;
  }, [autoRotate]);

  // Any drag, pinch or wheel stops the orbit at once so it never fights the
  // user; it eases back in after a quiet spell.
  useEffect(() => {
    const controls = get().controls as OrbitControlsImpl | null;
    if (!controlsReady || !controls) return;
    const start = () => {
      spin.current.interacting = true;
      spin.current.speed = 0;
    };
    const end = () => {
      spin.current.interacting = false;
      spin.current.holdUntil = performance.now() + AUTO_ROTATE_HOLD_MS;
    };
    controls.addEventListener("start", start);
    controls.addEventListener("end", end);
    return () => {
      controls.removeEventListener("start", start);
      controls.removeEventListener("end", end);
    };
  }, [get, controlsReady]);

  useEffect(() => {
    const { camera, controls: c } = get();
    const controls = c as OrbitControlsImpl | null;
    if (!controlsReady || !controls) return;
    // Flush leftover damping momentum (with damping off, update() applies and
    // clears it) so the camera doesn't keep drifting after the animation.
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    const prev = last.current;
    last.current = { mode, fieldId, resetToken };
    const keepView = prev && prev.fieldId === fieldId && prev.resetToken === resetToken;
    const toTarget = keepView ? controls.target.clone().setY(0) : new THREE.Vector3();
    const distance = keepView
      ? THREE.MathUtils.clamp(camera.position.distanceTo(controls.target), 0.6, 22)
      : defaultDistance(mode, camera, extent);
    const toPos = toTarget.clone().add(cameraOffset(mode, distance));
    if (!prev) {
      camera.position.copy(toPos);
      controls.target.copy(toTarget);
      applyConstraints(controls, mode);
      controls.update();
      return;
    }
    controls.enabled = false;
    // Lift the rotation lock so the camera can travel out of plan view.
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    const from = new THREE.Spherical().setFromVector3(
      camera.position.clone().sub(controls.target),
    );
    const to = new THREE.Spherical().setFromVector3(toPos.clone().sub(toTarget));
    // Turn the shortest way round so a reset from a rotated view never spins.
    to.theta = from.theta + THREE.MathUtils.euclideanModulo(to.theta - from.theta + Math.PI, Math.PI * 2) - Math.PI;
    anim.current = {
      from,
      to,
      fromTarget: controls.target.clone(),
      toTarget,
      start: performance.now(),
      mode,
    };
  }, [get, controlsReady, mode, fieldId, resetToken, extent]);

  useFrame((_, delta) => {
    const { camera, controls: c } = get();
    const controls = c as OrbitControlsImpl | null;
    if (!controls) return;
    const a = anim.current;
    const sp = spin.current;
    if (a) {
      const k = Math.min((performance.now() - a.start) / TRANSITION_MS, 1);
      const eased = 1 - (1 - k) ** 3;
      // Orbit around the moving target rather than cutting straight across.
      controls.target.lerpVectors(a.fromTarget, a.toTarget, eased);
      const sph = new THREE.Spherical(
        THREE.MathUtils.lerp(a.from.radius, a.to.radius, eased),
        THREE.MathUtils.lerp(a.from.phi, a.to.phi, eased),
        THREE.MathUtils.lerp(a.from.theta, a.to.theta, eased),
      );
      camera.position.setFromSpherical(sph).add(controls.target);
      camera.lookAt(controls.target);
      sp.speed = 0;
      if (k >= 1) {
        anim.current = null;
        applyConstraints(controls, a.mode);
        controls.enabled = true;
        controls.update();
        sp.holdUntil = performance.now() + AUTO_ROTATE_HOLD_MS;
      }
    } else {
      // Ease the angular speed toward its goal (faster to stop than to start),
      // then orbit the camera about the vertical through the target. The
      // controls re-read the camera each update, so nothing snaps back.
      const dt = Math.min(delta, 0.1);
      const goal =
        sp.enabled && !sp.interacting && performance.now() > sp.holdUntil ? AUTO_ROTATE_SPEED : 0;
      const tau = goal > sp.speed ? 1.4 : 0.3;
      sp.speed += (goal - sp.speed) * (1 - Math.exp(-dt / tau));
      if (goal === 0 && sp.speed < 1e-5) sp.speed = 0;
      if (sp.speed > 0) {
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(UP, -sp.speed * dt);
        camera.position.copy(controls.target).add(offset);
        camera.lookAt(controls.target);
      }
      const t = controls.target;
      const cx = THREE.MathUtils.clamp(t.x, -PAN_LIMIT, PAN_LIMIT);
      const cz = THREE.MathUtils.clamp(t.z, -PAN_LIMIT, PAN_LIMIT);
      if (cx !== t.x || cz !== t.z || t.y !== 0) {
        const shift = new THREE.Vector3(cx - t.x, -t.y, cz - t.z);
        t.add(shift);
        camera.position.add(shift);
      }
    }
    const dx = controls.target.x - camera.position.x;
    const dz = controls.target.z - camera.position.z;
    headingStore.set(
      Math.abs(dx) + Math.abs(dz) < 1e-3 ? 0 : Math.round(Math.atan2(dx, -dz) * 100) / 100,
    );
  });

  return null;
}

const UP = new THREE.Vector3(0, 1, 0);

function HoverPicker({
  field,
  exaggeration,
  uniformsRef,
}: {
  field: Heightfield;
  exaggeration: number;
  uniformsRef: React.RefObject<TerrainUniforms | null>;
}) {
  const { camera, gl } = useThree();
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const dirty = useRef(false);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useEffect(() => {
    const el = gl.domElement;
    const move = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.current = {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
      };
      dirty.current = true;
    };
    const leave = () => {
      pointer.current = null;
      dirty.current = true;
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [gl]);

  useEffect(() => {
    dirty.current = true;
  }, [field, exaggeration]);

  useEffect(
    () => () => {
      hoverStore.set(null);
    },
    [],
  );

  // Re-picks every frame while the cursor is over the map, since camera
  // damping and transitions change what is under it. A pick is a few hundred
  // heightfield samples, well under a millisecond.
  useFrame(() => {
    if (!dirty.current && !pointer.current) return;
    dirty.current = false;
    const u = uniformsRef.current;
    if (!pointer.current) {
      hoverStore.set(null);
      if (u) u.uHover.value = 0;
      return;
    }
    raycaster.setFromCamera(new THREE.Vector2(pointer.current.x, pointer.current.y), camera);
    const { origin, direction } = raycaster.ray;
    const pick = pickTerrain(field, exaggeration, origin, direction);
    const prev = hoverStore.get();
    if (
      !pick ||
      !prev ||
      Math.abs(prev.e - pick.e) > 1 ||
      Math.abs(prev.n - pick.n) > 1
    ) {
      hoverStore.set(pick);
    }
    if (u) {
      u.uHover.value = pick ? 1 : 0;
      if (pick) u.uHoverElev.value = pick.elevation;
    }
  });

  return null;
}

function HoverMarker({ color }: { color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const pick = hoverStore.get();
    mesh.visible = !!pick;
    if (!pick) return;
    mesh.position.set(pick.point.x, pick.point.y + 0.002, pick.point.z);
    const size = camera.position.distanceTo(mesh.position) * 0.012;
    mesh.scale.setScalar(size);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} raycast={() => null} renderOrder={2}>
      <ringGeometry args={[0.55, 0.8, 32]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
    </mesh>
  );
}

function LabelProjector({
  field,
  exaggeration,
  labels,
}: {
  field: Heightfield;
  exaggeration: number;
  labels: boolean;
}) {
  const { camera, size } = useThree();
  const anchors = useMemo(() => {
    const s = sceneScale(field) * exaggeration;
    return field.landmarks.flatMap((l) => {
      const elev = sampleElevation(field, l.e, l.n);
      if (Number.isNaN(elev)) return [];
      const p = toScene(field, l.e, l.n);
      return [{ name: l.name, pos: new THREE.Vector3(p.x, Math.max(elev, 0) * s, p.z) }];
    });
  }, [field, exaggeration]);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    for (const a of anchors) {
      const el = labelElements.get(a.name);
      if (!el) continue;
      v.copy(a.pos).project(camera);
      const visible = labels && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      el.style.visibility = visible ? "visible" : "hidden";
      if (!visible) continue;
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  });

  return null;
}

/** Outline of the detailed Bristol area, draped over the wider terrains. */
function FocusOutline({
  field,
  exaggeration,
  color,
}: {
  field: Heightfield;
  exaggeration: number;
  color: string;
}) {
  const line = useMemo(() => {
    const { west, east, north, south } = manifest.focus;
    const corners: [number, number][] = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
      [west, north],
    ];
    const pts: { e: number; n: number }[] = [];
    for (let i = 0; i < corners.length - 1; i++) {
      const [e0, n0] = corners[i];
      const [e1, n1] = corners[i + 1];
      const steps = Math.ceil(Math.max(Math.abs(e1 - e0), Math.abs(n1 - n0)) / (field.cell / 2));
      for (let j = 0; j <= steps; j++) {
        pts.push({ e: e0 + ((e1 - e0) * j) / steps, n: n0 + ((n1 - n0) * j) / steps });
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts.length * 3), 3));
    const material = new THREE.LineBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.75,
    });
    const obj = new THREE.Line(geometry, material);
    obj.userData.points = pts;
    obj.renderOrder = 1;
    return obj;
  }, [field]);

  useEffect(() => {
    const s = sceneScale(field) * exaggeration;
    const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const pts = line.userData.points as { e: number; n: number }[];
    pts.forEach((pt, i) => {
      const p = toScene(field, pt.e, pt.n);
      const h = sampleElevation(field, pt.e, pt.n);
      attr.setXYZ(i, p.x, Math.max(Number.isNaN(h) ? 0 : h, 0) * s + 0.01, p.z);
    });
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }, [line, field, exaggeration]);

  useEffect(() => {
    (line.material as THREE.LineBasicMaterial).color.set(color);
  }, [line, color]);

  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );

  return <primitive object={line} />;
}

/** Wider areas than the focus box get its outline drawn on them. */
function showsFocus(field: Heightfield) {
  const { west, north, east, south } = manifest.focus;
  return (
    field.west < west ||
    field.north > north ||
    field.west + field.cols * field.cell > east ||
    field.north - field.rows * field.cell < south
  );
}

export default function TerrainScene(props: TerrainSceneProps) {
  const {
    field,
    mode,
    exaggeration,
    wireframe,
    contours,
    labels,
    models,
    resetToken,
    autoRotate,
    osm,
    osmEnabled,
    routes,
    palette,
  } = props;
  const osmForField = osm && osm.dataset === field.id ? osm : null;
  const overlay = useOsmTextures(field, osmForField);
  const cls = (name: FillClass) => osmEnabled[osm?.classes.indexOf(name) ?? -1] ?? false;
  const fillsOn: Record<FillClass, boolean> = {
    water: cls("water"),
    park: cls("park"),
    wood: cls("wood"),
    open: cls("open"),
    residential: cls("residential"),
    commercial: cls("commercial"),
    industrial: cls("industrial"),
  };
  const uniformsRef = useRef<TerrainUniforms | null>(null);
  const coarse =
    typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  return (
    <Canvas
      dpr={coarse ? [1, 1.5] : [1, 2]}
      camera={{ fov: FOV, near: 0.01, far: 200, position: [0, 6.6, 8.8] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      fallback={
        <p className="p-6 text-xs uppercase tracking-[0.08em] text-hud-text">
          This browser does not support WebGL, which the map needs.
        </p>
      }
      className="touch-none"
    >
      <color attach="background" args={[palette.background]} />
      <TerrainMesh
        field={field}
        exaggeration={exaggeration}
        wireframe={wireframe}
        contours={contours}
        overlay={overlay}
        fillsOn={fillsOn}
        palette={palette}
        uniformsRef={uniformsRef}
      />
      {osmForField && (
        <OsmLines
          field={field}
          osm={osmForField}
          enabled={osmEnabled}
          exaggeration={exaggeration}
          palette={palette}
        />
      )}
      {showsFocus(field) && <FocusOutline field={field} exaggeration={exaggeration} color={palette.accent} />}
      <RouteLayer
        field={field}
        routes={routes}
        exaggeration={exaggeration}
        casing={palette.routeCasing}
      />
      {models && <LandmarkModels field={field} exaggeration={exaggeration} palette={palette} />}
      <LabelProjector field={field} exaggeration={exaggeration} labels={labels} />
      <HoverMarker color={palette.accent} />
      <HoverPicker field={field} exaggeration={exaggeration} uniformsRef={uniformsRef} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        zoomSpeed={0.8}
        zoomToCursor={false}
      />
      <CameraRig mode={mode} field={field} resetToken={resetToken} autoRotate={autoRotate} />
    </Canvas>
  );
}
