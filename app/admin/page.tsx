import type { Metadata } from "next";
import { AdminDashboard } from "@/components/AdminDashboard";
import { requireAdminPage } from "@/lib/session";
import { sortRides } from "@/lib/rides";
import { readRides } from "@/lib/storage";
import type { Ride } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Admin · Ride Board",
  robots: { index: false, follow: false },
};

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  await requireAdminPage();
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  let rides: Ride[] = [];
  let loadError: string | undefined;
  try {
    rides = sortRides(await readRides());
  } catch (error) {
    loadError = (error as Error).message;
  }

  return (
    <AdminDashboard
      initialRides={rides}
      loadError={loadError}
      initialEditId={first(params.edit)}
      focusField={first(params.focus)}
    />
  );
}
