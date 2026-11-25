import {
  parseTrack,
  toBng,
  trackWasRepaired,
  type MappableTrack,
  type TrackDiagnostics,
  type TrackIssue,
} from "./route-track";
import type { Ride } from "./types";
import { hostMatches, parseHttpsUrl } from "./urls";

/**
 * Route geometry for the map overlay. Points are British National Grid
 * metres (EPSG:27700) to match the terrain, flattened as [e0, n0, e1, n1, ...].
 */
export type RouteOverlay = {
  rideId: string;
  title: string;
  date: string;
  provider: string;
  status: "ok" | "unsupported" | "unavailable";
  /** Why the geometry is missing, shown in the map UI. */
  reason?: string;
  /** Machine-readable cause, for logs and tests. */
  code?: RouteIssueCode;
  name?: string;
  distanceM?: number;
  elevationGainM?: number;
  points?: number[];
  /** BNG metres, for "outside this area" hints. */
  bounds?: MappableTrack["bounds"];
  start?: MappableTrack["start"];
  end?: MappableTrack["end"];
  diagnostics?: TrackDiagnostics;
  /** Served from an earlier good fetch because the latest one failed. */
  stale?: boolean;
};

export type RouteIssueCode =
  | TrackIssue
  | "unsupported_link"
  | "private"
  | "upstream_error"
  | "network";

export type RwgpsRef = { type: "routes" | "trips"; id: string; privacyCode?: string };

/** Ride with GPS route/trip id from a normal share link. Short /s/ links are not supported. */
export function parseRwgpsUrl(value: string): RwgpsRef | null {
  const url = parseHttpsUrl(value);
  if (!url || !hostMatches(url.hostname, "ridewithgps.com")) return null;
  const match = url.pathname.match(/^\/(routes|trips)\/(\d+)\/?$/);
  if (!match) return null;
  const privacyCode = url.searchParams.get("privacy_code") ?? undefined;
  return {
    type: match[1] as RwgpsRef["type"],
    id: match[2],
    ...(privacyCode && /^\w+$/.test(privacyCode) ? { privacyCode } : {}),
  };
}

/** Builds the public JSON URL from parsed parts only, never from the raw link. */
export function rwgpsJsonUrl(ref: RwgpsRef): string {
  const url = new URL(`https://ridewithgps.com/${ref.type}/${ref.id}.json`);
  if (ref.privacyCode) url.searchParams.set("privacy_code", ref.privacyCode);
  return url.toString();
}

type RwgpsTrackPoint = { x?: unknown; y?: unknown };

/** Converts RWGPS track points (x = lon, y = lat) to rounded BNG metres. */
export function trackToGrid(points: RwgpsTrackPoint[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    if (typeof p.x !== "number" || typeof p.y !== "number") continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const [e, n] = toBng.forward([p.x, p.y]);
    out.push(Math.round(e), Math.round(n));
  }
  return out;
}

type Fetched = Omit<RouteOverlay, "rideId" | "title" | "date">;

const TTL_MS = 6 * 60 * 60 * 1000;
/** Private / missing / trackless routes: the owner has to change something. */
const PERMANENT_FAIL_TTL_MS = 10 * 60 * 1000;
/** Timeouts, rate limits and 5xx: try again on the next request soon. */
const TRANSIENT_FAIL_TTL_MS = 30 * 1000;
const TIMEOUT_MS = 15_000;
const ATTEMPTS = 3;
const CONCURRENCY = 3;

const cache = new Map<string, { at: number; ttl: number; value: Fetched }>();
/** Last good result per route, served if a later refresh fails. */
const lastGood = new Map<string, Fetched>();
/** One upstream request per route at a time, however many callers ask. */
const inFlight = new Map<string, Promise<Fetched>>();

class TransientError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Route id without the privacy code, safe to log. */
const logId = (ref: RwgpsRef) => `rwgps ${ref.type}/${ref.id}`;

function log(level: "warn" | "info", message: string, detail?: unknown) {
  if (process.env.NODE_ENV === "test") return;
  console[level](`[routes] ${message}`, ...(detail === undefined ? [] : [detail]));
}

async function requestRwgps(ref: RwgpsRef, fetcher: typeof fetch): Promise<Fetched> {
  const url = rwgpsJsonUrl(ref);
  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetcher(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
      });
      if (res.status === 403 || res.status === 404 || res.status === 401) {
        return {
          provider: "ridewithgps",
          status: "unavailable",
          code: "private",
          reason: "Route is private or missing. Share it publicly or include its privacy code.",
        };
      }
      if (res.status === 429 || res.status >= 500) {
        throw new TransientError(`Ride with GPS returned ${res.status}.`);
      }
      if (!res.ok) {
        return {
          provider: "ridewithgps",
          status: "unavailable",
          code: "upstream_error",
          reason: `Ride with GPS returned ${res.status}.`,
        };
      }
      let body: Record<string, unknown>;
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch (error) {
        // A body cut off mid-download looks like bad JSON; treat it as transient.
        if (error instanceof Error && error.name !== "SyntaxError") throw error;
        throw new TransientError("Ride with GPS sent an incomplete response.");
      }
      const route = ((body.route ?? body.trip ?? body) || {}) as Record<string, unknown>;
      const track = parseTrack(route);
      if (!track.ok) {
        log("warn", `${logId(ref)} not mappable: ${track.issue}`, track.diagnostics);
        return {
          provider: "ridewithgps",
          status: "unavailable",
          code: track.issue,
          reason: track.reason,
          diagnostics: track.diagnostics,
        };
      }
      if (trackWasRepaired(track.diagnostics)) {
        log("info", `${logId(ref)} repaired track`, track.diagnostics);
      }
      return {
        provider: "ridewithgps",
        status: "ok",
        name: typeof route.name === "string" ? route.name : undefined,
        distanceM: typeof route.distance === "number" ? route.distance : track.lengthM,
        elevationGainM: typeof route.elevation_gain === "number" ? route.elevation_gain : undefined,
        points: track.points,
        bounds: track.bounds,
        start: track.start,
        end: track.end,
        diagnostics: track.diagnostics,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < ATTEMPTS) {
        log("info", `${logId(ref)} attempt ${attempt} failed (${lastError}); retrying`);
        await sleep(300 * 2 ** (attempt - 1));
      }
    }
  }
  log("warn", `${logId(ref)} failed after ${ATTEMPTS} attempts: ${lastError}`);
  return {
    provider: "ridewithgps",
    status: "unavailable",
    code: "network",
    reason: "Could not reach Ride with GPS. Try again shortly.",
  };
}

async function fetchRwgps(ref: RwgpsRef, fetcher: typeof fetch): Promise<Fetched> {
  const key = rwgpsJsonUrl(ref);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = requestRwgps(ref, fetcher)
    .then((value) => {
      if (value.status === "ok") {
        lastGood.set(key, value);
        cache.set(key, { at: Date.now(), ttl: TTL_MS, value });
        return value;
      }
      const transient = value.code === "network";
      const previous = lastGood.get(key);
      if (transient && previous) {
        log("warn", `${logId(ref)} refresh failed; serving last good geometry`);
        const stale = { ...previous, stale: true };
        cache.set(key, { at: Date.now(), ttl: TRANSIENT_FAIL_TTL_MS, value: stale });
        return stale;
      }
      cache.set(key, {
        at: Date.now(),
        ttl: transient ? TRANSIENT_FAIL_TTL_MS : PERMANENT_FAIL_TTL_MS,
        value,
      });
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Runs tasks with at most `limit` in flight, keeping result order. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Resolves overlay geometry for every ride that has a route link. */
export async function routeOverlays(
  rides: Ride[],
  fetcher: typeof fetch = fetch,
): Promise<RouteOverlay[]> {
  // Limited concurrency so a board with many routes doesn't burst Ride with
  // GPS into rate limiting.
  return mapLimited(
    rides.filter((r) => r.route),
    CONCURRENCY,
    async (ride): Promise<RouteOverlay> => {
        const base = { rideId: ride.id, title: ride.title, date: ride.date };
        const route = ride.route!;
        const ref = route.provider === "ridewithgps" ? parseRwgpsUrl(route.url) : null;
        if (!ref) {
          return {
            ...base,
            provider: route.provider,
            status: "unsupported" as const,
            code: "unsupported_link" as const,
            reason:
              route.provider === "ridewithgps"
                ? "Use a full ridewithgps.com/routes/<id> link to show this route."
                : route.provider === "strava"
                  ? "Strava routes need a signed-in Strava API connection."
                  : "Only Ride with GPS routes can be drawn on the map.",
          };
        }
        return { ...base, ...(await fetchRwgps(ref, fetcher)) };
    },
  );
}

export function clearRouteCache() {
  cache.clear();
  lastGood.clear();
  inFlight.clear();
}
