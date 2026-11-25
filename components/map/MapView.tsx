"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withBase } from "@/lib/basePath";
import {
  decodeHeightfield,
  formatGridRef,
  manifest,
  type Heightfield,
  type TerrainDataset,
} from "@/lib/terrain/heightfield";
import {
  OSM_GROUPS,
  OSM_LAYERS,
  decodeOsm,
  enabledClasses,
  insideDataset,
  osmManifest,
  osmMetaFor,
  type OsmData,
  type OsmLayerId,
  type OsmMeta,
} from "@/lib/terrain/osm";
import type { RouteOverlay } from "@/lib/route-geometry";
import { useTheme } from "@/lib/theme";
import { PALETTES } from "./palette";
import type { RouteLine } from "./RouteLayer";
import { headingStore, hoverStore, labelElements, useStore } from "./mapStore";
import type { MapMode } from "./TerrainScene";

const TerrainScene = dynamic(() => import("./TerrainScene"), { ssr: false });

const DEFAULT_EXAGGERATION: Record<string, number> = { bristol: 3, avon: 4, region: 8 };

/** Exaggeration range and labelled stops per area. */
const EXAGGERATION: Record<string, { max: number; ticks: number[] }> = {
  bristol: { max: 20, ticks: [1, 2, 3, 5, 10, 20] },
  avon: { max: 30, ticks: [1, 2, 3, 5, 10, 20, 30] },
  region: { max: 50, ticks: [1, 2, 5, 10, 20, 50] },
};

// The slider is logarithmic so low values (where most detail is) get as much
// travel as the dramatic high ones.
const SLIDER_STEPS = 1000;
const toSlider = (value: number, max: number) =>
  Math.round((Math.log(value) / Math.log(max)) * SLIDER_STEPS);
const fromSlider = (pos: number, max: number) => {
  const v = Math.exp((pos / SLIDER_STEPS) * Math.log(max));
  return v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
};

function ExaggerationControl({
  value,
  max,
  ticks,
  onChange,
}: {
  value: number;
  max: number;
  ticks: number[];
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="exaggeration"
        className="flex justify-between text-[10px] uppercase tracking-[0.1em] text-hud-text"
      >
        Exaggeration
        <span className="tabular-nums text-hud-strong">{value.toFixed(value < 10 ? 1 : 0)}×</span>
      </label>
      <input
        id="exaggeration"
        type="range"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={toSlider(value, max)}
        aria-valuetext={`${value} times`}
        onChange={(e) => onChange(fromSlider(Number(e.target.value), max))}
        className="h-1 w-full cursor-pointer accent-[var(--hud-strong)]"
      />
      <div className="relative h-3.5">
        {ticks.map((t) => {
          const left = (toSlider(t, max) / SLIDER_STEPS) * 100;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onChange(t)}
              className={`absolute -translate-x-1/2 text-[9px] tabular-nums ${
                value === t ? "text-hud-strong" : "text-hud-muted hover:text-hud-strong"
              }`}
              style={{ left: `clamp(6px, ${left}%, calc(100% - 8px))` }}
            >
              {t}×
            </button>
          );
        })}
      </div>
    </div>
  );
}

const cache = new Map<string, Promise<Heightfield>>();

function loadHeightfield(dataset: TerrainDataset): Promise<Heightfield> {
  let promise = cache.get(dataset.id);
  if (!promise) {
    promise = fetch(withBase(`/terrain/${dataset.file}`))
      .then((res) => {
        if (!res.ok) throw new Error(`Terrain request failed (${res.status}).`);
        return res.arrayBuffer();
      })
      .then((buffer) => decodeHeightfield(dataset, buffer));
    promise.catch(() => cache.delete(dataset.id));
    cache.set(dataset.id, promise);
  }
  return promise;
}

const osmCache = new Map<string, Promise<OsmData>>();

function loadOsm(meta: OsmMeta): Promise<OsmData> {
  let promise = osmCache.get(meta.dataset);
  if (!promise) {
    promise = fetch(withBase(`/terrain/${meta.file}`))
      .then((res) => {
        if (!res.ok) throw new Error(`Map overlay request failed (${res.status}).`);
        return res.arrayBuffer();
      })
      .then((buffer) => decodeOsm(meta, buffer));
    promise.catch(() => osmCache.delete(meta.dataset));
    osmCache.set(meta.dataset, promise);
  }
  return promise;
}

// Countryside covers most land outside Bristol, so it starts off to keep the
// default view as clean as before; everything else matches the old toggles.
const DEFAULT_LAYERS: Record<OsmLayerId, boolean> = {
  roads: true,
  paths: true,
  rail: true,
  water: true,
  wood: true,
  park: true,
  open: false,
  residential: true,
  commercial: true,
  industrial: true,
};

let routesRequest: Promise<RouteOverlay[]> | null = null;

/**
 * Fetches route overlays. Concurrent callers share one request, but nothing
 * is cached past completion: each visit to the map (or a retry) asks the
 * server again, so newly added rides and recovered routes show up without a
 * full page reload. The server keeps its own cache of upstream results.
 */
function loadRoutes(): Promise<RouteOverlay[]> {
  if (!routesRequest) {
    routesRequest = fetch(withBase("/api/routes"), { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Routes request failed (${res.status}).`);
        return res.json() as Promise<{ routes: RouteOverlay[] }>;
      })
      .then((body) => {
        if (!Array.isArray(body?.routes)) throw new Error("Routes response was malformed.");
        return body.routes;
      })
      .finally(() => {
        routesRequest = null;
      });
  }
  return routesRequest;
}

/** Logs each route that cannot be drawn, once per distinct problem. */
const loggedRouteIssues = new Set<string>();
function logRouteIssues(routes: RouteOverlay[]) {
  for (const r of routes) {
    if (r.status === "ok" && !r.stale) continue;
    const key = `${r.rideId}:${r.status}:${r.code}:${r.stale}`;
    if (loggedRouteIssues.has(key)) continue;
    loggedRouteIssues.add(key);
    console.warn(
      `[map] route for "${r.title}" (${r.rideId}) ${r.stale ? "is stale" : `not mappable: ${r.code ?? r.status}`}`,
      { provider: r.provider, reason: r.reason, diagnostics: r.diagnostics },
    );
  }
}

/** Share of a route's points inside the dataset (0-1). */
function coverage(points: number[], field: Heightfield | null) {
  if (!field || points.length < 2) return 1;
  let inside = 0;
  for (let k = 0; k < points.length; k += 2) {
    if (insideDataset(field, points[k], points[k + 1])) inside++;
  }
  return inside / (points.length / 2);
}

const km = (m?: number) => (m === undefined ? "" : `${(m / 1000).toFixed(1)} km`);

function RouteSelect({
  routes,
  error,
  loading,
  value,
  onChange,
  onRetry,
  colors,
  field,
}: {
  colors: string[];
  routes: RouteOverlay[] | null;
  error: boolean;
  loading: boolean;
  value: string;
  onChange: (value: string) => void;
  onRetry: () => void;
  field: Heightfield | null;
}) {
  const drawable = routes?.filter(isDrawable) ?? [];
  const unavailable = routes?.filter((r) => !isDrawable(r)) ?? [];
  return (
    <div className="flex flex-col gap-1 border-t border-hud-line pt-2">
      <div className="flex items-baseline justify-between">
        <label
          htmlFor="route-overlay"
          className="text-[10px] uppercase tracking-[0.1em] text-hud-muted"
        >
          Routes
        </label>
        {(error || unavailable.some((r) => r.status === "unavailable")) && (
          <button
            type="button"
            onClick={onRetry}
            disabled={loading}
            className="text-[9px] uppercase tracking-[0.1em] text-hud-text hover:text-hud-strong disabled:opacity-50"
          >
            {loading ? "Retrying…" : "Retry"}
          </button>
        )}
      </div>
      <select
        id="route-overlay"
        value={value}
        disabled={!routes}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-7 w-full border border-hud-line bg-hud px-1.5 text-[11px] text-hud-strong disabled:opacity-50"
      >
        <option value="none">
          {routes ? "None" : error ? "Routes unavailable" : "Loading…"}
        </option>
        {drawable.map((r) => (
          <option key={r.rideId} value={r.rideId}>
            {r.title}
          </option>
        ))}
        {drawable.length > 1 && <option value="all">All routes</option>}
        {unavailable.length > 0 && (
          <optgroup label="Not available on the map">
            {unavailable.map((r) => (
              <option key={r.rideId} value={r.rideId} disabled title={r.reason}>
                {r.title} ({r.provider})
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {drawable.map((r, i) => {
        if (value !== "all" && value !== r.rideId) return null;
        const share = coverage(r.points!, field);
        return (
          <div key={r.rideId} className="flex flex-col gap-0.5">
            <p className="flex items-center gap-1.5 text-[10px] text-hud-text">
              <span
                className="h-0.5 w-3 shrink-0"
                style={{ background: colors[i % colors.length] }}
              />
              <span className="truncate">{r.name ?? r.title}</span>
              <span className="ml-auto shrink-0 tabular-nums text-hud-muted">
                {km(r.distanceM)}
                {r.elevationGainM !== undefined && ` · ${Math.round(r.elevationGainM)} m↑`}
              </span>
            </p>
            {share < 0.98 && (
              <p className="text-[9px] leading-snug text-hud-muted">
                {share === 0
                  ? "Outside this area. Switch to Region to see it."
                  : "Partly outside this area. Switch to Region for the whole route."}
              </p>
            )}
          </div>
        );
      })}
      {unavailable.length > 0 && value === "none" && (
        <p className="text-[9px] leading-snug text-hud-muted">
          {unavailable.length} ride{unavailable.length > 1 ? "s" : ""} use routes that cannot be
          drawn yet ({[...new Set(unavailable.map((r) => r.provider))].join(", ")}).
        </p>
      )}
    </div>
  );
}

/** Drawable: status ok with usable geometry (the server already validated it). */
function isDrawable(r: RouteOverlay) {
  return r.status === "ok" && Array.isArray(r.points) && r.points.length >= 4;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex border border-hud-line">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-7 flex-1 px-2.5 text-[10px] font-medium uppercase tracking-[0.1em] transition-colors ${
            value === o.value
              ? "bg-hud-active text-hud-active-fg"
              : "text-hud-text hover:bg-hud-hover hover:text-hud-strong"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  indeterminate = false,
  muted = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Group toggle with only some members on. */
  indeterminate?: boolean;
  /** Smaller, quieter style for sub-options. */
  muted?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-1.5 uppercase hover:text-hud-strong ${
        muted ? "text-[9px] tracking-[0.08em] text-hud-muted" : "text-[10px] tracking-[0.1em] text-hud-text"
      }`}
    >
      <input
        type="checkbox"
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 accent-[var(--hud-strong)]"
      />
      {label}
    </label>
  );
}

function HoverReadout() {
  const pick = useStore(hoverStore);
  return (
    <p
      className="min-h-4 text-[11px] tabular-nums tracking-[0.06em] text-hud-text"
      aria-live="off"
    >
      {pick ? (
        <>
          <span className="text-hud-muted">{formatGridRef(pick.e, pick.n, 4)}</span>
          <span className="mx-2 text-hud-muted">·</span>
          <span className="text-map-accent">{Math.round(pick.elevation)} m</span>
        </>
      ) : (
        <span className="text-hud-muted">Hover terrain for elevation</span>
      )}
    </p>
  );
}

function RotationToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={on ? "Pause map rotation" : "Resume map rotation"}
      aria-label={on ? "Pause map rotation" : "Resume map rotation"}
      className="flex h-9 w-7 items-center justify-center border border-hud-line bg-hud text-hud-text hover:border-hud-line-strong hover:text-hud-strong"
    >
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true" fill="currentColor">
        {on ? (
          <>
            <rect x="2" y="1.5" width="2" height="7" />
            <rect x="6" y="1.5" width="2" height="7" />
          </>
        ) : (
          <path d="M2.5 1.5 L8.5 5 L2.5 8.5 Z" />
        )}
      </svg>
    </button>
  );
}

function Compass({ onReset }: { onReset: () => void }) {
  const heading = useStore(headingStore);
  const degrees = Math.round(((((heading * 180) / Math.PI) % 360) + 360) % 360);
  return (
    <button
      type="button"
      onClick={onReset}
      title="Reset to north-up"
      aria-label={`Heading ${degrees} degrees. Reset to north-up view`}
      className="flex h-9 w-9 items-center justify-center border border-hud-line bg-hud text-[10px] text-hud-text hover:border-hud-line-strong hover:text-hud-strong"
    >
      <span
        className="flex flex-col items-center leading-none transition-transform duration-75"
        style={{ transform: `rotate(${-heading}rad)` }}
        aria-hidden="true"
      >
        <span className="text-map-accent">▲</span>
        <span>N</span>
      </span>
    </button>
  );
}

// Stem length and side per label, so the dense central Bristol cluster
// (bridge, Brandon Hill, Park Street, Harbourside) and the Bristol/Bath/
// Mendip group in the regional view stay readable.
const LABEL_LAYOUT: Record<string, { stem: number; side: "left" | "right" }> = {
  "Clifton Down": { stem: 22, side: "left" },
  "Avon Gorge": { stem: 64, side: "left" },
  "Clifton Suspension Bridge": { stem: 36, side: "left" },
  "Ashton Court": { stem: 12, side: "left" },
  "Belmont Hill": { stem: 30, side: "left" },
  "Constitution Hill": { stem: 58, side: "left" },
  Clifton: { stem: 40, side: "right" },
  "Brandon Hill": { stem: 14, side: "right" },
  "Park Street": { stem: 44, side: "right" },
  Harbourside: { stem: 14, side: "right" },
  Bristol: { stem: 40, side: "left" },
  Bath: { stem: 26, side: "right" },
  "Mendip Hills": { stem: 12, side: "left" },
  Gloucester: { stem: 14, side: "left" },
  "Pen y Fan": { stem: 14, side: "left" },
};

function LandmarkLabels({ field }: { field: Heightfield }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {field.landmarks.map((l) => {
        const layout = LABEL_LAYOUT[l.name] ?? { stem: 16, side: "right" };
        const left = layout.side === "left";
        return (
          <div
            key={l.name}
            ref={(el) => {
              if (el) labelElements.set(l.name, el);
              else labelElements.delete(l.name);
            }}
            className="invisible absolute left-0 top-0"
          >
            <span className="absolute -left-[3.5px] -top-[3.5px] h-[7px] w-[7px] rounded-full border border-map-label-line bg-map-label" />
            <span
              className="absolute left-0 w-px bg-map-label-line"
              style={{ top: -layout.stem, height: layout.stem - 3 }}
            />
            <span
              className={`absolute whitespace-nowrap border border-hud-line bg-map-label px-1.5 py-px text-[10px] uppercase leading-4 tracking-[0.08em] text-hud-strong ${
                left ? "right-0" : "left-0"
              }`}
              style={{ top: -layout.stem - 18 }}
            >
              {l.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function MapView() {
  const theme = useTheme();
  const palette = PALETTES[theme];
  const routeColors = palette.routeColors;
  const [datasetId, setDatasetId] = useState(manifest.datasets[0].id);
  const [mode, setMode] = useState<MapMode>("3d");
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION[datasetId] ?? 3);
  const [wireframe, setWireframe] = useState(true);
  const [contours, setContours] = useState(true);
  const [labels, setLabels] = useState(true);
  const [models, setModels] = useState(true);
  const [resetToken, setResetToken] = useState(0);
  const [field, setField] = useState<Heightfield | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNotice, setShowNotice] = useState(false);
  const [osm, setOsm] = useState<OsmData | null>(null);
  const [osmError, setOsmError] = useState(false);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const osmEnabled = useMemo(() => enabledClasses(osmManifest, layers), [layers]);
  const [routes, setRoutes] = useState<RouteOverlay[] | null>(null);
  const [routesError, setRoutesError] = useState(false);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [routeChoice, setRouteChoice] = useState("none");
  const [autoRotate, setAutoRotate] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const drawableRoutes = useMemo(() => routes?.filter(isDrawable) ?? [], [routes]);
  // A refresh can drop or add routes; never keep pointing at one that is gone.
  const activeChoice =
    routeChoice === "all"
      ? drawableRoutes.length > 1
        ? "all"
        : (drawableRoutes[0]?.rideId ?? "none")
      : drawableRoutes.some((r) => r.rideId === routeChoice)
        ? routeChoice
        : "none";
  const routeLines = useMemo<RouteLine[]>(
    () =>
      drawableRoutes.flatMap((r, i) =>
        activeChoice === "all" || activeChoice === r.rideId
          ? [{ id: r.rideId, color: routeColors[i % routeColors.length], points: r.points! }]
          : [],
      ),
    [drawableRoutes, activeChoice, routeColors],
  );

  // Only the latest request may update state, so a slow earlier response
  // (or one from an unmounted view) can't overwrite newer routes.
  const routesSeq = useRef(0);
  const fetchRoutes = useCallback(() => {
    const seq = ++routesSeq.current;
    loadRoutes().then(
      (r) => {
        if (seq !== routesSeq.current) return;
        logRouteIssues(r);
        setRoutes(r);
        setRoutesError(false);
        setRoutesLoading(false);
      },
      (e: Error) => {
        if (seq !== routesSeq.current) return;
        console.warn(`[map] routes request failed: ${e.message}`);
        setRoutesError(true);
        setRoutesLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    fetchRoutes();
    const seq = routesSeq;
    // Invalidate any response still in flight when the map unmounts.
    return () => {
      seq.current++;
    };
  }, [fetchRoutes]);

  function retryRoutes() {
    setRoutesLoading(true);
    fetchRoutes();
  }

  const dataset = manifest.datasets.find((d) => d.id === datasetId) ?? manifest.datasets[0];
  const osmMeta = osmMetaFor(dataset.id);
  // Overlay for the area on screen, if it has loaded.
  const osmForDataset = osm?.dataset === dataset.id ? osm : null;

  useEffect(() => {
    let active = true;
    loadHeightfield(dataset).then(
      (f) => {
        if (!active) return;
        setField(f);
        setError(null);
      },
      (e: Error) => active && setError(e.message),
    );
    return () => {
      active = false;
    };
  }, [dataset]);

  useEffect(() => {
    if (!osmMeta || osm?.dataset === osmMeta.dataset) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the error for the new area
    setOsmError(false);
    loadOsm(osmMeta).then(
      (data) => active && setOsm(data),
      () => active && setOsmError(true),
    );
    return () => {
      active = false;
    };
  }, [osmMeta, osm]);

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 767px), (pointer: coarse)");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- depends on the browser only
    setShowNotice(narrow.matches);
    if (reduceMotion.matches) setAutoRotate(false);
  }, []);

  function changeDataset(id: string) {
    setDatasetId(id);
    setExaggeration(DEFAULT_EXAGGERATION[id] ?? 3);
  }

  const loading = !error && field?.id !== dataset.id;

  return (
    <section
      aria-label="Topographic map"
      className="relative h-[calc(100dvh-1.75rem)] w-full overflow-hidden bg-map-bg text-hud-strong"
    >
      {field && (
        <div className="absolute inset-0">
          <TerrainScene
            field={field}
            mode={mode}
            exaggeration={exaggeration}
            wireframe={wireframe}
            contours={contours}
            labels={labels}
            models={models}
            resetToken={resetToken}
            autoRotate={autoRotate}
            osm={osm}
            osmEnabled={osmEnabled}
            routes={routeLines}
            palette={palette}
          />
          <LandmarkLabels key={field.id} field={field} />
        </div>
      )}

      {(loading || error) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p
            role="status"
            className={`text-[11px] uppercase tracking-[0.1em] ${error ? "text-danger" : "text-hud-muted"}`}
          >
            {error ? `Could not load terrain. ${error}` : "Loading terrain…"}
          </p>
        </div>
      )}

      {/* Planning panel slides off the left edge; its tab stays on screen. */}
      <div
        className="pointer-events-none absolute bottom-[5.5rem] left-0 top-3 flex items-start transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{ transform: panelOpen ? "translateX(0)" : "translateX(calc(-100% + 1.5rem))" }}
      >
      <div
        id="map-panel"
        inert={!panelOpen}
        className="pointer-events-auto ml-3 flex max-h-full w-[min(15rem,calc(100vw-8rem))] flex-col gap-2.5 overflow-y-auto border border-hud-line bg-hud p-3 backdrop-blur-sm"
      >
        <div className="flex items-baseline justify-between">
          <h1 className="text-[11px] font-bold uppercase tracking-[0.14em] text-hud-strong">
            Bristol terrain
          </h1>
          <span className="text-[10px] uppercase tracking-[0.1em] text-hud-muted">
            {dataset.cell} m grid
          </span>
        </div>
        <Segmented
          label="Area"
          value={datasetId}
          onChange={changeDataset}
          options={manifest.datasets.map((d) => ({ value: d.id, label: d.label }))}
        />
        <ExaggerationControl
          value={exaggeration}
          max={(EXAGGERATION[dataset.id] ?? EXAGGERATION.bristol).max}
          ticks={(EXAGGERATION[dataset.id] ?? EXAGGERATION.bristol).ticks}
          onChange={setExaggeration}
        />
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          <Toggle label="Wireframe" checked={wireframe} onChange={setWireframe} />
          <Toggle label="Contours" checked={contours} onChange={setContours} />
          <Toggle label="Labels" checked={labels} onChange={setLabels} />
          <Toggle label="Models" checked={models} onChange={setModels} />
        </div>
        <RouteSelect
          colors={routeColors}
          routes={routes}
          error={routesError}
          loading={routesLoading}
          value={activeChoice}
          onChange={setRouteChoice}
          onRetry={retryRoutes}
          field={field}
        />
        {osmMeta && (
          <fieldset className="flex flex-col gap-1.5 border-t border-hud-line pt-2">
            <legend className="sr-only">Map layers</legend>
            <span className="text-[10px] uppercase tracking-[0.1em] text-hud-muted">
              {osmError ? "Map layers unavailable" : osmForDataset ? "Layers" : "Loading layers…"}
            </span>
            {osmForDataset && (
              <>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {OSM_LAYERS.filter((l) => l.group === "network").map((l) => (
                    <Toggle
                      key={l.id}
                      label={l.label}
                      checked={layers[l.id]}
                      onChange={(v) => setLayers((prev) => ({ ...prev, [l.id]: v }))}
                    />
                  ))}
                </div>
                {OSM_GROUPS.map((g) => {
                  const members = OSM_LAYERS.filter((l) => l.group === g.id);
                  const on = members.filter((l) => layers[l.id]).length;
                  return (
                    <div key={g.id} role="group" aria-label={g.label} className="flex flex-col gap-1">
                      <Toggle
                        label={g.label}
                        checked={on === members.length}
                        indeterminate={on > 0 && on < members.length}
                        onChange={(v) =>
                          setLayers((prev) => ({
                            ...prev,
                            ...Object.fromEntries(members.map((l) => [l.id, v])),
                          }))
                        }
                      />
                      <div className="flex flex-wrap gap-x-3 gap-y-1.5 pl-[18px]">
                        {members.map((l) => (
                          <Toggle
                            key={l.id}
                            label={l.label}
                            muted
                            checked={layers[l.id]}
                            onChange={(v) => setLayers((prev) => ({ ...prev, [l.id]: v }))}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </fieldset>
        )}
      </div>
      <button
        type="button"
        onClick={() => setPanelOpen((o) => !o)}
        aria-expanded={panelOpen}
        aria-controls="map-panel"
        title={panelOpen ? "Hide panel" : "Show panel"}
        aria-label={panelOpen ? "Hide map panel" : "Show map panel"}
        className="pointer-events-auto flex h-12 w-6 items-center justify-center border border-l-0 border-hud-line bg-hud text-hud-text backdrop-blur-sm hover:text-hud-strong"
      >
        <svg
          viewBox="0 0 10 10"
          className={`h-2.5 w-2.5 transition-transform duration-300 motion-reduce:transition-none ${panelOpen ? "" : "rotate-180"}`}
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <path d="M6.5 1.5 L3 5 L6.5 8.5" />
        </svg>
      </button>
      </div>

      <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
        <div className="flex gap-1.5">
          <RotationToggle on={autoRotate} onChange={setAutoRotate} />
          <Compass onReset={() => setResetToken((t) => t + 1)} />
        </div>
        <div role="group" aria-label="Projection" className="flex w-9 flex-col border border-hud-line bg-hud">
          {(["plan", "3d"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`h-7 text-[10px] font-medium uppercase tracking-[0.06em] ${
                mode === m
                  ? "bg-hud-active text-hud-active-fg"
                  : "text-hud-text hover:bg-hud-hover hover:text-hud-strong"
              }`}
            >
              {m === "plan" ? "2D" : "3D"}
            </button>
          ))}
        </div>
      </div>

      {showNotice && (
        <div className="absolute inset-x-3 bottom-24 flex items-center justify-between gap-2 border border-hud-line bg-hud px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-hud-text md:hidden">
          <span>Map works best on desktop</span>
          <button
            type="button"
            onClick={() => setShowNotice(false)}
            className="text-hud-strong"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1.5 border border-hud-line bg-hud px-3 py-2">
          <HoverReadout />
          <div className="flex items-center gap-2 text-[10px] tabular-nums text-hud-muted">
            <span>{Math.round(dataset.minElevation)} m</span>
            <span
              className="h-1.5 w-28"
              style={{
                background:
                  "linear-gradient(to right, var(--legend-low), var(--legend-mid), var(--legend-high))",
              }}
            />
            <span>{Math.round(dataset.maxElevation)} m</span>
            <span className="ml-1 text-hud-muted">
              contours {dataset.contour.minor}/{dataset.contour.major} m
            </span>
          </div>
        </div>
        <p className="text-right text-[9px] tracking-[0.04em] text-hud-muted">
          {manifest.attribution}
          {osmMeta && <> · Map data {osmMeta.attribution}</>}
          {routeLines.length > 0 && <> · Routes: Ride with GPS</>}
        </p>
      </div>
    </section>
  );
}
