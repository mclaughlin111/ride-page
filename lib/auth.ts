import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { BASE_PATH } from "./basePath";

export const SESSION_COOKIE = "ride_board_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;
const MIN_SECRET_LENGTH = 16;

export type AuthConfig = { password: string; secret: string };

/** Returns config only when both env vars are set; never exposed to the browser. */
export function getAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig | null {
  const password = env.ADMIN_PASSWORD;
  const secret = env.SESSION_SECRET;
  if (!password || !secret || secret.length < MIN_SECRET_LENGTH) return null;
  return { password, secret };
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time password comparison (hashing equalises the lengths). */
export function verifyPassword(input: unknown, expected: string): boolean {
  if (typeof input !== "string") return false;
  return timingSafeEqual(sha256(input), sha256(expected));
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(
  secret: string,
  nowMs: number = Date.now(),
  ttlSeconds: number = SESSION_TTL_SECONDS,
): string {
  const payload = Buffer.from(
    JSON.stringify({ iat: nowMs, exp: nowMs + ttlSeconds * 1000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(
  token: string | undefined | null,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return false;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof data.exp === "number" && data.exp > nowMs;
  } catch {
    return false;
  }
}

export function isAuthenticatedToken(token: string | undefined | null): boolean {
  const config = getAuthConfig();
  return config ? verifySessionToken(token, config.secret) : false;
}

export function sessionCookieOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: BASE_PATH || "/",
  };
}

// Small in-memory limiter to slow down password guessing.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

export function isRateLimited(key: string, nowMs: number = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= nowMs) return false;
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(key: string, nowMs: number = Date.now()): void {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= nowMs) {
    attempts.set(key, { count: 1, resetAt: nowMs + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}

export function resetRateLimiter(): void {
  attempts.clear();
}
