import type { NextRequest } from "next/server";
import {
  checkSameOrigin,
  json,
  readJson,
  requireAdmin,
  storageErrorResponse,
} from "@/lib/api";
import { attachPreviewImages } from "@/lib/preview";
import { createRide, sortRides } from "@/lib/rides";
import { readRides, updateRides } from "@/lib/storage";
import { newId, parseRideInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ rides: sortRides(await readRides()) });
  } catch (error) {
    return storageErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request) ?? checkSameOrigin(request);
  if (denied) return denied;

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const parsed = parseRideInput(body.body);
  if (!parsed.ok) return json({ errors: parsed.errors }, 400);

  try {
    const input = await attachPreviewImages(parsed.value);
    const ride = await updateRides((rides) => {
      const created = createRide(input, newId());
      return { rides: [...rides, created], result: created };
    });
    return json({ ride }, 201);
  } catch (error) {
    return storageErrorResponse(error);
  }
}
