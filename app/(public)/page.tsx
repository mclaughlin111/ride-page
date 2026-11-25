import { RideBoard } from "@/components/RideBoard";
import { LoadError } from "@/components/States";
import { ViewToggle } from "@/components/ViewToggle";
import { MapView } from "@/components/map/MapView";
import { sortRides } from "@/lib/rides";
import { hasAdminSession } from "@/lib/session";
import { readRides } from "@/lib/storage";
import type { Ride } from "@/lib/types";
import { ROOT_PATH } from "@/lib/basePath";
import { parseView } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const rideParam = params.ride;
  const rideId = Array.isArray(rideParam) ? rideParam[0] : rideParam;

  if (parseView(params.view) === "map") {
    return (
      <>
        <ViewToggle view="map" />
        <MapView />
      </>
    );
  }

  let rides: Ride[];
  try {
    rides = sortRides(await readRides());
  } catch (error) {
    return (
      <>
        <ViewToggle view="planner" />
        <main className="mx-auto flex min-h-[calc(100dvh-1.75rem)] w-full max-w-xl flex-col justify-center px-4">
          <LoadError message={(error as Error).message} retryHref={ROOT_PATH} />
        </main>
      </>
    );
  }

  const isAdmin = await hasAdminSession();
  return (
    <>
      <ViewToggle view="planner" />
      <RideBoard rides={rides} initialRideId={rideId} isAdmin={isAdmin} />
    </>
  );
}
