import type { NextRequest } from "next/server";
import { isAuthenticated, json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return json({ authenticated: isAuthenticated(request) });
}
