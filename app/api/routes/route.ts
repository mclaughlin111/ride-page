import { json, storageErrorResponse } from "@/lib/api";
import { routeOverlays } from "@/lib/route-geometry";
import { sortRides } from "@/lib/rides";
import { readRides } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Public: route geometry for the map overlay (rides are already public). */
export async function GET() {
  let rides;
  try {
    rides = sortRides(await readRides());
  } catch (error) {
    return storageErrorResponse(error);
  }
  return json({ routes: await routeOverlays(rides) });
}
