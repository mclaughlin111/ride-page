import { randomBytes } from "node:crypto";
import { detectProvider, isApprovedEmbedUrl } from "./route-embed";
import {
  DEFAULT_TIMEZONE,
  ROUTE_PROVIDERS,
  type FieldErrors,
  type Ride,
  type RideInput,
  type RideRoute,
  type RideStop,
  type RouteProvider,
  type StravaEmbed,
} from "./types";
import { parseStravaEmbed } from "./strava";
import {
  extractIframeSrc,
  isAllowedImageUrl,
  isApprovedMapEmbedUrl,
  isValidGoogleMapsUrl,
  isValidStravaPostUrl,
  parseHttpsUrl,
} from "./urls";

export const LIMITS = {
  title: 120,
  name: 120,
  address: 240,
  description: 500,
  comments: 2000,
  stops: 20,
} as const;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldErrors };

export function newId(): string {
  return randomBytes(6).toString("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trimmed string, or undefined when empty/non-string. */
function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function checkLength(
  errors: FieldErrors,
  key: string,
  value: string | undefined,
  max: number,
) {
  if (value && value.length > max) {
    errors[key] = `Keep this under ${max} characters.`;
  }
}

function parseRoute(
  raw: unknown,
  errors: FieldErrors,
): RideRoute | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    errors.route = "Route is invalid.";
    return undefined;
  }
  const url = text(raw.url);
  const embedRaw = text(raw.embedUrl);
  const embedUrl = embedRaw ? extractIframeSrc(embedRaw) : undefined;
  const providerRaw = text(raw.provider);

  if (!url) {
    if (embedUrl) errors["route.url"] = "Add the route share link too.";
    return undefined;
  }

  const parsed = parseHttpsUrl(url);
  if (!parsed) {
    errors["route.url"] = "Enter a valid https:// route link.";
    return undefined;
  }

  let provider: RouteProvider;
  if (!providerRaw || providerRaw === "auto") {
    provider = detectProvider(url);
  } else if ((ROUTE_PROVIDERS as string[]).includes(providerRaw)) {
    provider = providerRaw as RouteProvider;
  } else {
    errors["route.provider"] = "Choose a supported route provider.";
    return undefined;
  }

  if (embedUrl) {
    if (!parseHttpsUrl(embedUrl)) {
      errors["route.embedUrl"] =
        "Paste the iframe src URL (https:// only) or the provider's iframe code.";
    } else if (!isApprovedEmbedUrl(embedUrl)) {
      errors["route.embedUrl"] =
        "This domain is not an approved embed source for the route providers.";
    }
  }

  return {
    provider,
    url: parsed.href,
    ...(embedUrl && !errors["route.embedUrl"]
      ? { embedUrl: new URL(embedUrl).href }
      : {}),
  };
}

function parseStops(
  raw: unknown,
  errors: FieldErrors,
  trustImages: boolean,
): RideStop[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.stops = "Stops must be a list.";
    return [];
  }
  if (raw.length > LIMITS.stops) {
    errors.stops = `Add at most ${LIMITS.stops} stops.`;
    return [];
  }
  const seen = new Set<string>();
  return raw.map((item, i) => {
    const key = `stops.${i}`;
    const stop = isRecord(item) ? item : {};
    const name = text(stop.name);
    const description = text(stop.description);
    const mapUrl = text(stop.mapUrl);
    if (!name) errors[`${key}.name`] = "Stop name is required.";
    checkLength(errors, `${key}.name`, name, LIMITS.name);
    checkLength(errors, `${key}.description`, description, LIMITS.description);
    if (mapUrl && !isValidGoogleMapsUrl(mapUrl)) {
      errors[`${key}.mapUrl`] = "Enter a valid Google Maps https:// link.";
    }
    let id = text(stop.id);
    if (!id || seen.has(id) || id.length > 64) id = newId();
    seen.add(id);
    const imageUrl = trustImages ? text(stop.imageUrl) : undefined;
    return {
      id,
      name: name ?? "",
      ...(description ? { description } : {}),
      ...(mapUrl ? { mapUrl: parseHttpsUrl(mapUrl)?.href ?? mapUrl } : {}),
      ...(imageUrl && isAllowedImageUrl(imageUrl) ? { imageUrl } : {}),
    };
  });
}

/** Validate untrusted ride fields (from the admin form or stored JSON). */
export function parseRideInput(
  raw: unknown,
  options: { trustImages?: boolean } = {},
): ParseResult<RideInput> {
  const trustImages = options.trustImages ?? false;
  const errors: FieldErrors = {};
  if (!isRecord(raw)) {
    return { ok: false, errors: { _form: "Request body must be an object." } };
  }

  const title = text(raw.title);
  if (!title) errors.title = "Title is required.";
  checkLength(errors, "title", title, LIMITS.title);

  const date = text(raw.date);
  if (!date) errors.date = "Date is required.";
  else if (!isValidDate(date)) errors.date = "Use a real date (YYYY-MM-DD).";

  const time = text(raw.time);
  if (!time) errors.time = "Start time is required.";
  else if (!isValidTime(time)) errors.time = "Use 24-hour time (HH:MM).";

  const timezone = text(raw.timezone) ?? DEFAULT_TIMEZONE;
  if (!isValidTimezone(timezone)) {
    errors.timezone = "Unknown timezone. Example: Europe/London.";
  }

  const meeting = isRecord(raw.meetingLocation) ? raw.meetingLocation : {};
  const meetingName = text(meeting.name);
  const meetingAddress = text(meeting.address);
  const meetingMapUrl = text(meeting.mapUrl);
  const meetingEmbedRaw = text(meeting.embedUrl);
  const meetingEmbedUrl = meetingEmbedRaw
    ? extractIframeSrc(meetingEmbedRaw)
    : undefined;
  if (!meetingName && (meetingAddress || meetingMapUrl || meetingEmbedUrl)) {
    errors["meetingLocation.name"] =
      "Add a location name, or clear the other meeting fields.";
  }
  checkLength(errors, "meetingLocation.name", meetingName, LIMITS.name);
  checkLength(errors, "meetingLocation.address", meetingAddress, LIMITS.address);
  if (meetingMapUrl && !isValidGoogleMapsUrl(meetingMapUrl)) {
    errors["meetingLocation.mapUrl"] = "Enter a valid Google Maps https:// link.";
  }
  if (meetingEmbedUrl && !isApprovedMapEmbedUrl(meetingEmbedUrl)) {
    errors["meetingLocation.embedUrl"] =
      "Paste the src from Google Maps > Share > Embed a map (https://www.google.com/maps/embed...).";
  }

  const route = parseRoute(raw.route, errors);
  const stops = parseStops(raw.stops, errors, trustImages);

  const comments = text(raw.comments);
  checkLength(errors, "comments", comments, LIMITS.comments);

  const status = raw.status ?? "upcoming";
  if (status !== "upcoming" && status !== "complete") {
    errors.status = "Status must be upcoming or complete.";
  }

  const stravaPostUrl = text(raw.stravaPostUrl);
  if (stravaPostUrl && !isValidStravaPostUrl(stravaPostUrl)) {
    errors.stravaPostUrl = "Enter a valid https://strava.com link.";
  }

  let stravaEmbed: StravaEmbed | undefined;
  if (raw.stravaEmbed !== undefined && raw.stravaEmbed !== null && raw.stravaEmbed !== "") {
    const embedInput =
      typeof raw.stravaEmbed === "string"
        ? raw.stravaEmbed
        : isRecord(raw.stravaEmbed)
          ? `<div class="strava-embed-placeholder" data-embed-type="${String(raw.stravaEmbed.type)}" data-embed-id="${String(raw.stravaEmbed.id)}"${
              raw.stravaEmbed.token ? ` data-token="${String(raw.stravaEmbed.token)}"` : ""
            }${raw.stravaEmbed.mapHash ? ` data-map-hash="${String(raw.stravaEmbed.mapHash)}"` : ""}></div>`
          : "";
    const parsedEmbed = parseStravaEmbed(embedInput);
    if (parsedEmbed) stravaEmbed = parsedEmbed;
    else {
      errors.stravaEmbed =
        "Paste Strava's embed code (the div with data-embed-type and data-embed-id) from the Share > Embed dialog.";
    }
  }

  const stravaImageUrl = trustImages ? text(raw.stravaImageUrl) : undefined;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      title: title!,
      date: date!,
      time: time!,
      timezone,
      ...(meetingName
        ? {
            meetingLocation: {
              name: meetingName,
              ...(meetingAddress ? { address: meetingAddress } : {}),
              ...(meetingMapUrl
                ? { mapUrl: parseHttpsUrl(meetingMapUrl)!.href }
                : {}),
              ...(meetingEmbedUrl
                ? { embedUrl: parseHttpsUrl(meetingEmbedUrl)!.href }
                : {}),
            },
          }
        : {}),
      ...(route ? { route } : {}),
      ...(comments ? { comments } : {}),
      stops,
      status: status as RideInput["status"],
      ...(stravaPostUrl
        ? { stravaPostUrl: parseHttpsUrl(stravaPostUrl)!.href }
        : {}),
      ...(stravaEmbed ? { stravaEmbed } : {}),
      ...(stravaImageUrl && isAllowedImageUrl(stravaImageUrl)
        ? { stravaImageUrl }
        : {}),
    },
  };
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** Validate a full stored ride, including id and timestamps. */
export function parseStoredRide(raw: unknown): ParseResult<Ride> {
  const parsed = parseRideInput(raw, { trustImages: true });
  if (!parsed.ok) return parsed;
  const r = raw as Record<string, unknown>;
  const errors: FieldErrors = {};
  if (typeof r.id !== "string" || !r.id.trim()) errors.id = "Missing id.";
  if (!isIsoTimestamp(r.createdAt)) errors.createdAt = "Invalid createdAt.";
  if (!isIsoTimestamp(r.updatedAt)) errors.updatedAt = "Invalid updatedAt.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...parsed.value,
      id: (r.id as string).trim(),
      createdAt: r.createdAt as string,
      updatedAt: r.updatedAt as string,
    },
  };
}

export function parseStoredRides(raw: unknown): ParseResult<Ride[]> {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: { _file: "rides.json must contain an array." } };
  }
  const rides: Ride[] = [];
  const errors: FieldErrors = {};
  const ids = new Set<string>();
  raw.forEach((item, i) => {
    const result = parseStoredRide(item);
    if (!result.ok) {
      for (const [k, v] of Object.entries(result.errors)) {
        errors[`[${i}].${k}`] = v;
      }
      return;
    }
    if (ids.has(result.value.id)) {
      errors[`[${i}].id`] = "Duplicate ride id.";
      return;
    }
    ids.add(result.value.id);
    rides.push(result.value);
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: rides };
}
