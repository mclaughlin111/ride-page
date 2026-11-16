import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isAuthenticatedToken } from "./auth";
import { StorageError } from "./storage";

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function isAuthenticated(request: NextRequest): boolean {
  return isAuthenticatedToken(request.cookies.get(SESSION_COOKIE)?.value);
}

/** Returns an error response unless the request carries a valid admin session. */
export function requireAdmin(request: NextRequest): NextResponse | null {
  if (!isAuthenticated(request)) {
    return json(
      { error: "Admin session missing or expired. Please log in again." },
      401,
    );
  }
  return null;
}

/** Reject cross-site mutation requests (defence in depth on top of SameSite). */
export function checkSameOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    if (host && new URL(origin).host === host) return null;
  } catch {
    // fall through to rejection
  }
  return json({ error: "Cross-origin request blocked." }, 403);
}

export function storageErrorResponse(error: unknown): NextResponse {
  if (error instanceof StorageError) {
    return json({ error: error.message, kind: error.kind }, 500);
  }
  return json({ error: "Unexpected server error." }, 500);
}

export async function readJson(
  request: NextRequest,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON body." }, 400) };
  }
}
