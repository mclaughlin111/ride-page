import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearAttempts,
  createSessionToken,
  getAuthConfig,
  isRateLimited,
  recordFailedAttempt,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";
import { checkSameOrigin, json, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() || "local";
}

export async function POST(request: NextRequest) {
  const blocked = checkSameOrigin(request);
  if (blocked) return blocked;

  const config = getAuthConfig();
  if (!config) {
    return json(
      {
        error:
          "Admin login is not configured. Set ADMIN_PASSWORD and SESSION_SECRET (16+ characters).",
      },
      503,
    );
  }

  const key = clientKey(request);
  if (isRateLimited(key)) {
    return json({ error: "Too many attempts. Try again later." }, 429);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const password = (body.body as { password?: unknown } | null)?.password;

  if (!verifyPassword(password, config.password)) {
    recordFailedAttempt(key);
    return json({ error: "Incorrect password." }, 401);
  }

  clearAttempts(key);
  const response = json({ authenticated: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(config.secret), {
    ...sessionCookieOptions(),
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
