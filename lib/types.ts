export type RideStatus = "upcoming" | "complete";

export type RouteProvider =
  | "ridewithgps"
  | "strava"
  | "garmin"
  | "komoot"
  | "other";

export type RideStop = {
  id: string;
  name: string;
  description?: string;
  mapUrl?: string;
  /** Preview image found server-side from mapUrl; never accepted from clients. */
  imageUrl?: string;
};

/** Values from Strava's official embed snippet (data-embed-* attributes). */
export type StravaEmbed = {
  type: "activity" | "route";
  id: string;
  token?: string;
  mapHash?: string;
};

export type RideRoute = {
  provider: RouteProvider;
  url: string;
  embedUrl?: string;
};

export type Ride = {
  id: string;
  title: string;
  date: string;
  time: string;
  timezone?: string;
  meetingLocation?: {
    name: string;
    address?: string;
    mapUrl?: string;
    /** Google Maps embed iframe src. */
    embedUrl?: string;
  };
  route?: RideRoute;
  comments?: string;
  stops: RideStop[];
  status: RideStatus;
  stravaPostUrl?: string;
  stravaEmbed?: StravaEmbed;
  /** Preview image found server-side from stravaPostUrl; never accepted from clients. */
  stravaImageUrl?: string;
  createdAt: string;
  updatedAt: string;
};

/** Validated payload for creating or updating a ride (no id or timestamps). */
export type RideInput = Omit<Ride, "id" | "createdAt" | "updatedAt">;

export type FieldErrors = Record<string, string>;

export const ROUTE_PROVIDERS: RouteProvider[] = [
  "ridewithgps",
  "strava",
  "garmin",
  "komoot",
  "other",
];

export const PROVIDER_LABELS: Record<RouteProvider, string> = {
  ridewithgps: "Ride with GPS",
  strava: "Strava",
  garmin: "Garmin",
  komoot: "Komoot",
  other: "Other",
};

export const DEFAULT_TIMEZONE = "Europe/London";
