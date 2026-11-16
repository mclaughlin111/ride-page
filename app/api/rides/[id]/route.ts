import type { NextRequest } from "next/server";
import {
  checkSameOrigin,
  json,
  readJson,
  requireAdmin,
  storageErrorResponse,
} from "@/lib/api";
import { attachPreviewImages } from "@/lib/preview";
import { applyRideInput } from "@/lib/rides";
import { readRides, updateRides } from "@/lib/storage";
import { parseRideInput } from "@/lib/validation";
import type { Ride } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const NOT_FOUND = { error: "Ride not found." };

export async function PUT(request: NextRequest, { params }: Context) {
  const denied = requireAdmin(request) ?? checkSameOrigin(request);
  if (denied) return denied;

  const { id } = await params;
  const body = await readJson(request);
  if (!body.ok) return body.response;

  const parsed = parseRideInput(body.body);
  if (!parsed.ok) return json({ errors: parsed.errors }, 400);

  try {
    const current = (await readRides()).find((r) => r.id === id);
    if (!current) return json(NOT_FOUND, 404);
    const input = await attachPreviewImages(parsed.value, current);
    const ride = await updateRides<Ride | null>((rides) => {
      const existing = rides.find((r) => r.id === id);
      if (!existing) return { rides, result: null };
      const updated = applyRideInput(existing, input);
      return {
        rides: rides.map((r) => (r.id === id ? updated : r)),
        result: updated,
      };
    });
    return ride ? json({ ride }) : json(NOT_FOUND, 404);
  } catch (error) {
    return storageErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const denied = requireAdmin(request) ?? checkSameOrigin(request);
  if (denied) return denied;

  const { id } = await params;
  try {
    const removed = await updateRides((rides) => {
      const next = rides.filter((r) => r.id !== id);
      return { rides: next, result: next.length !== rides.length };
    });
    return removed ? json({ ok: true }) : json(NOT_FOUND, 404);
  } catch (error) {
    return storageErrorResponse(error);
  }
}
