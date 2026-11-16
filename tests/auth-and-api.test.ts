import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/preview", () => ({
  attachPreviewImages: async (input: unknown) => input,
}));
import {
  SESSION_COOKIE,
  createSessionToken,
  getAuthConfig,
  resetRateLimiter,
  verifyPassword,
  verifySessionToken,
} from "@/lib/auth";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { GET as listRides, POST as createRideRoute } from "@/app/api/rides/route";
import { DELETE, PUT } from "@/app/api/rides/[id]/route";

const SECRET = "test-secret-with-enough-length";
const PASSWORD = "correct horse";

describe("auth helpers", () => {
  it("verifies passwords", () => {
    expect(verifyPassword("abc", "abc")).toBe(true);
    expect(verifyPassword("abd", "abc")).toBe(false);
    expect(verifyPassword("", "abc")).toBe(false);
    expect(verifyPassword(undefined, "abc")).toBe(false);
  });

  it("accepts a fresh token and rejects tampered, wrong-secret and expired ones", () => {
    const now = 1_000_000;
    const token = createSessionToken(SECRET, now, 60);
    expect(verifySessionToken(token, SECRET, now + 1000)).toBe(true);
    expect(verifySessionToken(token, "another-secret-value-here", now)).toBe(false);
    expect(verifySessionToken(token, SECRET, now + 61_000)).toBe(false);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ exp: now + 9e9 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`, SECRET, now)).toBe(false);
    expect(verifySessionToken(`${payload}.`, SECRET, now)).toBe(false);
    expect(verifySessionToken("garbage", SECRET, now)).toBe(false);
    expect(verifySessionToken(undefined, SECRET, now)).toBe(false);
  });

  it("requires both env vars and a long enough secret", () => {
    expect(getAuthConfig({ ADMIN_PASSWORD: "x", SESSION_SECRET: SECRET } as never)).not.toBeNull();
    expect(getAuthConfig({ ADMIN_PASSWORD: "x" } as never)).toBeNull();
    expect(getAuthConfig({ ADMIN_PASSWORD: "x", SESSION_SECRET: "short" } as never)).toBeNull();
  });
});

const validBody = {
  title: "Sunday Social",
  date: "2026-10-11",
  time: "09:00",
  meetingLocation: { name: "Clock Tower", mapUrl: "https://maps.google.com/?q=clock" },
  route: { provider: "auto", url: "https://ridewithgps.com/routes/1" },
  stops: [{ name: "Cafe", mapUrl: "https://www.google.com/maps/place/Cafe" }],
  status: "upcoming",
};

function req(
  url: string,
  init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

let dir: string;
const authedCookie = () => `${SESSION_COOKIE}=${createSessionToken(SECRET)}`;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ride-board-api-"));
  process.env.DATA_FILE_PATH = path.join(dir, "rides.json");
  process.env.ADMIN_PASSWORD = PASSWORD;
  process.env.SESSION_SECRET = SECRET;
  resetRateLimiter();
});

afterEach(async () => {
  delete process.env.DATA_FILE_PATH;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.SESSION_SECRET;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("auth routes", () => {
  it("logs in with the right password and sets an HttpOnly signed cookie", async () => {
    const res = await login(req("/api/auth/login", { method: "POST", body: { password: PASSWORD } }));
    expect(res.status).toBe(200);
    const cookie = res.cookies.get(SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(verifySessionToken(cookie?.value, SECRET)).toBe(true);
    expect(JSON.stringify(await res.json())).not.toContain(PASSWORD);
  });

  it("rejects a wrong password without setting a cookie", async () => {
    const res = await login(req("/api/auth/login", { method: "POST", body: { password: "nope" } }));
    expect(res.status).toBe(401);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("rate limits repeated failures", async () => {
    for (let i = 0; i < 8; i++) {
      await login(req("/api/auth/login", { method: "POST", body: { password: "bad" } }));
    }
    const res = await login(req("/api/auth/login", { method: "POST", body: { password: PASSWORD } }));
    expect(res.status).toBe(429);
  });

  it("returns 503 when admin is not configured", async () => {
    delete process.env.ADMIN_PASSWORD;
    const res = await login(req("/api/auth/login", { method: "POST", body: { password: "x" } }));
    expect(res.status).toBe(503);
  });

  it("reports session state", async () => {
    expect(await (await sessionRoute(req("/api/auth/session"))).json()).toEqual({ authenticated: false });
    const res = await sessionRoute(req("/api/auth/session", { cookie: authedCookie() }));
    expect(await res.json()).toEqual({ authenticated: true });
    const bad = await sessionRoute(req("/api/auth/session", { cookie: `${SESSION_COOKIE}=bogus` }));
    expect(await bad.json()).toEqual({ authenticated: false });
  });

  it("logout clears the cookie", async () => {
    const res = await logout(req("/api/auth/logout", { method: "POST", cookie: authedCookie() }));
    const cookie = res.cookies.get(SESSION_COOKIE);
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
  });

  it("blocks cross-origin login attempts", async () => {
    const res = await login(
      req("/api/auth/login", { method: "POST", body: { password: PASSWORD }, headers: { origin: "https://evil.example" } }),
    );
    expect(res.status).toBe(403);
  });
});

describe("rides API", () => {
  it("allows public reads without a session", async () => {
    const res = await listRides();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rides: [] });
  });

  it("requires a session for every mutation", async () => {
    const created = await createRideRoute(req("/api/rides", { method: "POST", body: validBody }));
    expect(created.status).toBe(401);
    const ctx = { params: Promise.resolve({ id: "x" }) };
    expect((await PUT(req("/api/rides/x", { method: "PUT", body: validBody }), ctx)).status).toBe(401);
    expect((await DELETE(req("/api/rides/x", { method: "DELETE" }), ctx)).status).toBe(401);
    expect((await createRideRoute(req("/api/rides", { method: "POST", body: validBody, cookie: `${SESSION_COOKIE}=forged.value` }))).status).toBe(401);
  });

  it("rejects expired sessions", async () => {
    const expired = createSessionToken(SECRET, Date.now() - 10_000, 1);
    const res = await createRideRoute(req("/api/rides", { method: "POST", body: validBody, cookie: `${SESSION_COOKIE}=${expired}` }));
    expect(res.status).toBe(401);
  });

  it("creates, edits, completes, reopens and deletes a ride", async () => {
    const cookie = authedCookie();
    const created = await createRideRoute(req("/api/rides", { method: "POST", body: validBody, cookie }));
    expect(created.status).toBe(201);
    const { ride } = await created.json();
    expect(ride.route.provider).toBe("ridewithgps");
    expect(ride.timezone).toBe("Europe/London");
    expect(ride.stops[0].id).toBeTruthy();

    const ctx = { params: Promise.resolve({ id: ride.id }) };
    const stravaPostUrl = "https://www.strava.com/activities/99";
    const completed = await PUT(
      req(`/api/rides/${ride.id}`, { method: "PUT", cookie, body: { ...validBody, status: "complete", stravaPostUrl } }),
      ctx,
    );
    expect(completed.status).toBe(200);
    const done = (await completed.json()).ride;
    expect(done).toMatchObject({ status: "complete", stravaPostUrl, createdAt: ride.createdAt });

    const reopened = await PUT(
      req(`/api/rides/${ride.id}`, { method: "PUT", cookie, body: { ...validBody, status: "upcoming", stravaPostUrl } }),
      ctx,
    );
    expect((await reopened.json()).ride.status).toBe("upcoming");

    const list = await (await listRides()).json();
    expect(list.rides).toHaveLength(1);

    expect((await DELETE(req(`/api/rides/${ride.id}`, { method: "DELETE", cookie }), ctx)).status).toBe(200);
    expect((await DELETE(req(`/api/rides/${ride.id}`, { method: "DELETE", cookie }), ctx)).status).toBe(404);
    expect((await (await listRides()).json()).rides).toEqual([]);
  });

  it("returns field-level validation errors", async () => {
    const res = await createRideRoute(
      req("/api/rides", {
        method: "POST",
        cookie: authedCookie(),
        body: {
          title: "",
          date: "2026-02-31",
          time: "25:00",
          meetingLocation: { name: "", mapUrl: "https://evil.com/maps" },
          route: { url: "http://insecure.example" },
          stops: [{ name: "", mapUrl: "javascript:alert(1)" }],
          stravaPostUrl: "https://evil.example/post",
        },
      }),
    );
    expect(res.status).toBe(400);
    const { errors } = await res.json();
    expect(Object.keys(errors).sort()).toEqual(
      [
        "date",
        "meetingLocation.mapUrl",
        "meetingLocation.name",
        "route.url",
        "stops.0.mapUrl",
        "stops.0.name",
        "stravaPostUrl",
        "time",
        "title",
      ].sort(),
    );
  });

  it("returns 404 when editing an unknown ride and 400 on bad JSON", async () => {
    const cookie = authedCookie();
    const ctx = { params: Promise.resolve({ id: "missing" }) };
    expect((await PUT(req("/api/rides/missing", { method: "PUT", cookie, body: validBody }), ctx)).status).toBe(404);
    const bad = new NextRequest("http://localhost:3000/api/rides", {
      method: "POST",
      headers: { cookie, host: "localhost:3000" },
      body: "{oops",
    });
    expect((await createRideRoute(bad)).status).toBe(400);
  });

  it("reports a failed JSON read to public readers", async () => {
    await fs.writeFile(process.env.DATA_FILE_PATH!, "{ broken");
    const res = await listRides();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/not valid JSON/);
  });

  it("reports a failed save", async () => {
    process.env.DATA_FILE_PATH = dir; // a directory cannot be read as a file
    const res = await createRideRoute(req("/api/rides", { method: "POST", cookie: authedCookie(), body: validBody }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBeTruthy();
  });

  it("sorts rides in list responses", async () => {
    const cookie = authedCookie();
    for (const date of ["2026-12-01", "2026-10-01"]) {
      await createRideRoute(req("/api/rides", { method: "POST", cookie, body: { ...validBody, date } }));
    }
    const { rides } = await (await listRides()).json();
    expect(rides.map((r: { date: string }) => r.date)).toEqual(["2026-10-01", "2026-12-01"]);
  });
});
