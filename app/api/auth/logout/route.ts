import type { NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { checkSameOrigin, json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const blocked = checkSameOrigin(request);
  if (blocked) return blocked;
  const response = json({ authenticated: false });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
