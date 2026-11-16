import { RideBoard } from "@/components/RideBoard";
import { LoadError } from "@/components/States";
import { sortRides } from "@/lib/rides";
import { hasAdminSession } from "@/lib/session";
import { readRides } from "@/lib/storage";
import type { Ride } from "@/lib/types";
import { ROOT_PATH } from "@/lib/basePath";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const rideParam = params.ride;
  const rideId = Array.isArray(rideParam) ? rideParam[0] : rideParam;

  let rides: Ride[];
  try {
    rides = sortRides(await readRides());
  } catch (error) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-4">
        <LoadError message={(error as Error).message} retryHref={ROOT_PATH} />
      </main>
    );
  }

  const isAdmin = await hasAdminSession();
  return <RideBoard rides={rides} initialRideId={rideId} isAdmin={isAdmin} />;
}
