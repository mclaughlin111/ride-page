import { DEFAULT_TIMEZONE, type Ride, type RideInput } from "./types";

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Absolute start instant (ms since epoch) for a ride's local date and time. */
export function rideStartMs(
  ride: Pick<Ride, "date" | "time" | "timezone">,
): number {
  const [y, m, d] = ride.date.split("-").map(Number);
  const [hh, mm] = ride.time.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm);
  const timeZone = ride.timezone || DEFAULT_TIMEZONE;
  try {
    const first = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
    return wallAsUtc - zoneOffsetMs(first, timeZone);
  } catch {
    return wallAsUtc;
  }
}

/**
 * Upcoming rides first (soonest first), then completed rides (most recent
 * first). Ties fall back to title then id so the order is stable.
 */
export function sortRides<T extends Ride>(rides: readonly T[]): T[] {
  return [...rides].sort((a, b) => {
    const aDone = a.status === "complete";
    const bDone = b.status === "complete";
    if (aDone !== bDone) return aDone ? 1 : -1;
    const diff = rideStartMs(a) - rideStartMs(b);
    const ordered = aDone ? -diff : diff;
    if (ordered !== 0) return ordered;
    return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}

export function isComplete(ride: Pick<Ride, "status">): boolean {
  return ride.status === "complete";
}

/** The Strava post link is only meaningful (and only shown) once a ride is complete. */
export function getStravaPostUrl(ride: Ride): string | undefined {
  return isComplete(ride) ? ride.stravaPostUrl : undefined;
}

export function setRideStatus(
  ride: Ride,
  status: Ride["status"],
  now: Date = new Date(),
): Ride {
  if (ride.status === status) return ride;
  return { ...ride, status, updatedAt: now.toISOString() };
}

export function applyRideInput(
  existing: Ride,
  input: RideInput,
  now: Date = new Date(),
): Ride {
  return {
    ...input,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now.toISOString(),
  };
}

export function createRide(
  input: RideInput,
  id: string,
  now: Date = new Date(),
): Ride {
  const stamp = now.toISOString();
  return { ...input, id, createdAt: stamp, updatedAt: stamp };
}

export function formatRideDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

// --- Mini calendar ---------------------------------------------------------

export type MonthGrid = {
  label: string;
  /** Monday-first weeks; null pads days outside the month. */
  weeks: (number | null)[][];
  day: number;
};

export function buildMonthGrid(date: string): MonthGrid {
  const [y, m, d] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1, 12));
  const daysInMonth = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(first);
  return { label, weeks, day: d };
}

// --- Carousel navigation -------------------------------------------------

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

export function nextIndex(index: number, length: number): number {
  return clampIndex(index + 1, length);
}

export function prevIndex(index: number, length: number): number {
  return clampIndex(index - 1, length);
}

export function findRideIndex(
  rides: readonly Pick<Ride, "id">[],
  id: string | undefined,
): number {
  if (!id) return -1;
  return rides.findIndex((r) => r.id === id);
}

export const SWIPE_MIN_DISTANCE = 50;

/**
 * Convert a touch gesture into a navigation step: swipe left = next (+1),
 * swipe right = previous (-1). Mostly-vertical gestures are ignored so page
 * scrolling is unaffected.
 */
export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return 0;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
