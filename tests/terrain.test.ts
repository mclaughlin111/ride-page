import { describe, expect, it, vi } from "vitest";
import {
  clearRouteCache,
  parseRwgpsUrl,
  routeOverlays,
  rwgpsJsonUrl,
  trackToGrid,
} from "@/lib/route-geometry";
import { decodeOsm, densify, osmManifest, osmMetaFor } from "@/lib/terrain/osm";
import { makeRide } from "./fixtures";
import {
  decodeHeightfield,
  formatGridRef,
  fromScene,
  sampleElevation,
  sampleSurface,
  toScene,
  type TerrainDataset,
} from "@/lib/terrain/heightfield";
import { pickTerrain } from "@/lib/terrain/picking";
import { MAX_POINTS, parseTrack } from "@/lib/route-track";
import { parseView, viewSearch } from "@/lib/views";

const dataset: TerrainDataset = {
  id: "t",
  label: "T",
  file: "t.bin",
  west: 1000,
  north: 2000,
  cols: 3,
  rows: 2,
  cell: 50,
  minElevation: 0,
  maxElevation: 100,
  contour: { minor: 10, major: 50 },
  landmarks: [],
};

function encode(values: number[]) {
  const buf = new ArrayBuffer(values.length * 2);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setInt16(i * 2, v, true));
  return buf;
}

describe("heightfield", () => {
  it("decodes decimetres and NODATA", () => {
    const f = decodeHeightfield(dataset, encode([0, 105, -32768, 1000, 0, 0]));
    expect(f.elevation[1]).toBeCloseTo(10.5);
    expect(Number.isNaN(f.elevation[2])).toBe(true);
  });

  it("rejects a file of the wrong size", () => {
    expect(() => decodeHeightfield(dataset, encode([1, 2]))).toThrow(/expected 12/);
  });

  it("samples cell centres and interpolates between them", () => {
    const f = decodeHeightfield(dataset, encode([0, 0, 0, 1000, 0, 0]));
    // Row 1 col 0 centre: e = 1025, n = 1925.
    expect(sampleElevation(f, 1025, 1925)).toBeCloseTo(100);
    expect(sampleElevation(f, 1050, 1925)).toBeCloseTo(50);
    expect(Number.isNaN(sampleElevation(f, 5000, 1925))).toBe(true);
  });

  it("samples the rendered triangles, not a bilinear patch", () => {
    // Cell corners a=0 b=0 / d=0 e=1000 dm: bilinear gives 25 m at the
    // centre, the mesh (split along b-d) gives 0 there.
    const f = decodeHeightfield(dataset, encode([0, 0, 0, 0, 1000, 0]));
    expect(sampleElevation(f, 1050, 1950)).toBeCloseTo(25);
    expect(sampleSurface(f, 1050, 1950)).toBeCloseTo(0);
    expect(sampleSurface(f, 1070, 1930)).toBeCloseTo(80);
    expect(sampleSurface(f, 1075, 1925)).toBeCloseTo(100);
  });

  it("round-trips scene coordinates with north at -z", () => {
    const p = toScene(dataset, 1100, 1990);
    expect(p.z).toBeLessThan(0);
    const back = fromScene(dataset, p.x, p.z);
    expect(back.e).toBeCloseTo(1100);
    expect(back.n).toBeCloseTo(1990);
  });

  it("formats OS grid references", () => {
    expect(formatGridRef(358700, 172900)).toBe("ST 5870 7290");
  });
});

describe("pickTerrain", () => {
  it("hits a flat raised surface straight below the ray", () => {
    const f = decodeHeightfield(dataset, encode([500, 500, 500, 500, 500, 500]));
    const centre = toScene(f, 1075, 1950);
    const hit = pickTerrain(f, 1, { x: centre.x, y: 5, z: centre.z }, { x: 0, y: -1, z: 0 });
    expect(hit?.elevation).toBeCloseTo(50);
    expect(hit?.e).toBeCloseTo(1075, 0);
  });

  it("misses when the ray points away", () => {
    const f = decodeHeightfield(dataset, encode([0, 0, 0, 0, 0, 0]));
    expect(pickTerrain(f, 1, { x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
  });
});

describe("views", () => {
  it("parses the view param", () => {
    expect(parseView("map")).toBe("map");
    expect(parseView(["map"])).toBe("map");
    expect(parseView("other")).toBe("planner");
    expect(parseView(undefined)).toBe("planner");
  });

  it("keeps other params when switching", () => {
    expect(viewSearch("?ride=abc", "map")).toBe("?ride=abc&view=map");
    expect(viewSearch("?ride=abc&view=map", "planner")).toBe("?ride=abc");
    expect(viewSearch("?view=map", "planner")).toBe("");
  });
});

/** n evenly spaced [lon, lat] points from a to b. */
function line(lon0: number, lat0: number, lon1: number, lat1: number, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    // A slight bend so simplification keeps more than the ends.
    return [lon0 + (lon1 - lon0) * t, lat0 + (lat1 - lat0) * t + Math.sin(t * Math.PI) * 0.01];
  });
}

describe("route tracks", () => {
  const coords = line(-2.62, 51.44, -2.55, 51.47, 40);

  it("reads RWGPS, GeoJSON and GPX to the same geometry", () => {
    const rwgps = parseTrack({ track_points: coords.map(([x, y]) => ({ x, y })) });
    const geo = parseTrack({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords.map(([x, y]) => [x, y, 12]) },
    });
    const gpx = parseTrack(
      `<?xml version="1.0"?><gpx><trk><trkseg>${coords
        .map(([lon, lat]) => `<trkpt lon="${lon}" lat="${lat}"><ele>1</ele></trkpt>`)
        .join("")}</trkseg></trk></gpx>`,
    );
    expect(rwgps.ok && geo.ok && gpx.ok).toBe(true);
    if (!rwgps.ok || !geo.ok || !gpx.ok) return;
    expect(geo.points).toEqual(rwgps.points);
    expect(gpx.points).toEqual(rwgps.points);
    expect(rwgps.diagnostics.format).toBe("rwgps");
    expect(gpx.diagnostics.format).toBe("gpx");
  });

  it("drops bad points without rejecting the route", () => {
    const pts: unknown[] = coords.map(([x, y]) => ({ x, y }));
    pts.splice(5, 0, { x: null, y: 51.4 }, { x: "abc", y: 51.4 }, null, { x: 0, y: 0 }, { x: 200, y: 51 });
    // GPS glitch: one point 30 km away between two close neighbours.
    pts.splice(20, 0, { x: -2.2, y: 51.6 });
    const r = parseTrack({ route: { track_points: pts } });
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toMatchObject({ malformed: 3, nullIsland: 1, outOfRange: 1, spikes: 1 });
    if (r.ok) expect(r.bounds.east).toBeLessThan(362_000);
  });

  it("fixes reversed lat/lon", () => {
    const r = parseTrack({ type: "LineString", coordinates: coords.map(([lon, lat]) => [lat, lon]) });
    expect(r.ok).toBe(true);
    expect(r.diagnostics.swapped).toBe(true);
    if (r.ok) expect(r.start.lon).toBeCloseTo(-2.62);
  });

  it("rejects tracks that cannot make a meaningful route", () => {
    expect(parseTrack({ track_points: [] })).toMatchObject({ ok: false, issue: "no_track" });
    expect(parseTrack({ name: "metadata only" })).toMatchObject({ ok: false, issue: "no_track" });
    expect(parseTrack({ track_points: coords.slice(0, 3).map(([x, y]) => ({ x, y })) })).toMatchObject(
      { ok: false, issue: "too_few_points" },
    );
    const tiny = Array.from({ length: 10 }, (_, i) => ({ x: -2.6 + i * 0.0001, y: 51.45 }));
    expect(parseTrack({ track_points: tiny })).toMatchObject({ ok: false, issue: "too_short" });
    const paris = line(2.3, 48.85, 2.4, 48.9, 20).map(([x, y]) => ({ x, y }));
    expect(parseTrack({ track_points: paris })).toMatchObject({ ok: false, issue: "outside_map" });
  });

  it("caps very large tracks", () => {
    // 60k noisy points: simplification alone would keep most of them.
    const big = Array.from({ length: 60_000 }, (_, i) => ({
      x: -2.7 + i * 0.000004 + (i % 2) * 0.0003,
      y: 51.4 + (i % 3) * 0.0003,
    }));
    const r = parseTrack({ track_points: big });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.points.length / 2).toBeLessThanOrEqual(MAX_POINTS);
    // Worst case for Douglas-Peucker; takes ~4 s locally and longer on CI runners.
  }, 30_000);
});

describe("route geometry", () => {
  it("parses RWGPS links and builds the JSON URL from parts only", () => {
    const ref = parseRwgpsUrl("https://ridewithgps.com/routes/57327103?privacy_code=abc123&x=1");
    expect(ref).toEqual({ type: "routes", id: "57327103", privacyCode: "abc123" });
    expect(rwgpsJsonUrl(ref!)).toBe(
      "https://ridewithgps.com/routes/57327103.json?privacy_code=abc123",
    );
    expect(parseRwgpsUrl("https://ridewithgps.com/s/abc")).toBeNull();
    expect(parseRwgpsUrl("https://evil.com/routes/1")).toBeNull();
  });

  it("converts track points to British National Grid", () => {
    const [e, n] = trackToGrid([{ x: -2.5879, y: 51.4545 }, { x: "bad", y: 1 }]);
    expect(e).toBeGreaterThan(358_000);
    expect(e).toBeLessThan(360_500);
    expect(n).toBeGreaterThan(172_000);
    expect(n).toBeLessThan(174_000);
  });

  it("returns geometry for RWGPS rides and reasons for others", async () => {
    clearRouteCache();
    const fetcher = vi.fn(async () =>
      Response.json({
        route: {
          name: "Loop",
          distance: 1000,
          elevation_gain: 50,
          track_points: line(-2.6, 51.45, -2.59, 51.46, 6).map(([x, y]) => ({ x, y })),
        },
      }),
    );
    const rides = [
      makeRide({ id: "a", route: { provider: "ridewithgps", url: "https://ridewithgps.com/routes/1" } }),
      makeRide({ id: "b", route: { provider: "strava", url: "https://www.strava.com/routes/2" } }),
      makeRide({ id: "c", route: undefined }),
    ];
    const out = await routeOverlays(rides, fetcher as unknown as typeof fetch);
    expect(out.map((r) => [r.rideId, r.status])).toEqual([
      ["a", "ok"],
      ["b", "unsupported"],
    ]);
    expect(out[0].points!.length).toBeGreaterThanOrEqual(4);
    expect(out[0].start?.lat).toBeCloseTo(51.45);
    expect(fetcher).toHaveBeenCalledWith("https://ridewithgps.com/routes/1.json", expect.anything());
  });

  it("retries transient failures and shares one request", async () => {
    clearRouteCache();
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls++;
      return calls === 1
        ? new Response("", { status: 503 })
        : Response.json({ track_points: line(-2.6, 51.45, -2.59, 51.46, 8).map(([x, y]) => ({ x, y })) });
    });
    const ride = makeRide({ route: { provider: "ridewithgps", url: "https://ridewithgps.com/routes/5" } });
    const [a, b] = await Promise.all([
      routeOverlays([ride], fetcher as unknown as typeof fetch),
      routeOverlays([ride], fetcher as unknown as typeof fetch),
    ]);
    expect(a[0].status).toBe("ok");
    expect(b[0].status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps serving the last good route when a refresh fails", async () => {
    clearRouteCache();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const good = Response.json({
        track_points: line(-2.6, 51.45, -2.59, 51.46, 8).map(([x, y]) => ({ x, y })),
      });
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(good)
        .mockRejectedValue(new TypeError("fetch failed"));
      const ride = makeRide({ route: { provider: "ridewithgps", url: "https://ridewithgps.com/routes/6" } });
      const first = await routeOverlays([ride], fetcher as unknown as typeof fetch);
      expect(first[0].status).toBe("ok");
      vi.setSystemTime(Date.now() + 7 * 60 * 60 * 1000);
      const second = await routeOverlays([ride], fetcher as unknown as typeof fetch);
      expect(second[0]).toMatchObject({ status: "ok", stale: true });
      expect(second[0].points).toEqual(first[0].points);
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);

  it("reports private routes as unavailable", async () => {
    clearRouteCache();
    const fetcher = vi.fn(async () => new Response("", { status: 403 }));
    const [r] = await routeOverlays(
      [makeRide({ route: { provider: "ridewithgps", url: "https://ridewithgps.com/routes/9" } })],
      fetcher as unknown as typeof fetch,
    );
    expect(r.status).toBe("unavailable");
    expect(r.reason).toMatch(/private/);
  });
});

describe("osm decoding", () => {
  const osmMeta = osmMetaFor("bristol")!;

  it("exposes one overlay per detailed dataset", () => {
    expect(osmManifest.overlays.map((o) => o.dataset)).toEqual(["bristol", "avon"]);
    expect(osmMetaFor("avon")?.file).toBe("osm-avon.bin");
    expect(osmMetaFor("region")).toBeNull();
  });

  it("decodes records relative to the origin", () => {
    const meta = { ...osmMeta, origin: { e: 1000, n: 2000 } };
    const data = Int16Array.from([2, 1, 2, 10, 20, -5, 7]);
    const { features } = decodeOsm(meta, data.buffer);
    expect(features).toHaveLength(1);
    expect(Array.from(features[0].rings[0])).toEqual([1010, 2020, 995, 2007]);
  });

  it("rejects corrupt data", () => {
    expect(() => decodeOsm(osmMeta, Int16Array.from([99, 1, 0]).buffer)).toThrow(/corrupt/);
  });

  it("densifies long segments", () => {
    const out = densify(Float64Array.from([0, 0, 100, 0]), 30);
    expect(out.length / 2).toBe(5);
    expect(out[out.length - 2]).toBe(100);
  });
});
