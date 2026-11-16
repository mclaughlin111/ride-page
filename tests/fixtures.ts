import type { Ride } from "@/lib/types";

export function makeRide(overrides: Partial<Ride> = {}): Ride {
  return {
    id: "ride-1",
    title: "Sunday Social",
    date: "2026-10-11",
    time: "09:00",
    timezone: "Europe/London",
    meetingLocation: { name: "Clock Tower", address: "1 High Street" },
    stops: [],
    status: "upcoming",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}
