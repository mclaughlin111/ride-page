const MAX_URL_LENGTH = 2048;

/** Parse an absolute https URL. Returns null for anything unsafe or invalid. */
export function parseHttpsUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname || !url.hostname.includes(".")) return null;
  return url;
}

export function isValidHttpsUrl(value: unknown): boolean {
  return parseHttpsUrl(value) !== null;
}

export function hostMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

// google.com, google.co.uk, google.com.au, google.de and so on.
const GOOGLE_HOST = /^(www\.)?google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2,3})$/i;

/**
 * Accepts Google Maps URLs (maps.google.com, google.com/maps) plus the
 * official short links produced by the Maps share button.
 */
export function isValidGoogleMapsUrl(value: unknown): boolean {
  const url = parseHttpsUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  if (host === "maps.google.com") return true;
  if (GOOGLE_HOST.test(host)) {
    return path === "/maps" || path.startsWith("/maps/");
  }
  if (host === "maps.app.goo.gl") return path.length > 1;
  if (host === "goo.gl") return path.startsWith("/maps/");
  return false;
}

export function isValidStravaPostUrl(value: unknown): boolean {
  const url = parseHttpsUrl(value);
  if (!url) return false;
  return hostMatches(url.hostname, "strava.com") || url.hostname === "strava.app.link";
}

/** Google Maps search link that needs no API key. */
export function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Use the stored map URL when present, otherwise fall back to a search link. */
export function resolveMapsUrl(
  mapUrl: string | undefined,
  name: string,
  address?: string,
): string {
  if (mapUrl && isValidGoogleMapsUrl(mapUrl)) return mapUrl;
  return googleMapsSearchUrl([name, address].filter(Boolean).join(", "));
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

function decodeEntities(value: string): string {
  return value.replace(/&(amp|quot|lt|gt|#39|#x27);/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m);
}

/**
 * Admins often paste a whole `<iframe ...>` snippet. Pull out just the `src`
 * value so it can be validated like any other URL. The HTML itself is never
 * stored or rendered.
 */
export function extractIframeSrc(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("<")) return trimmed;
  const match = trimmed.match(/<iframe\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const src = match?.[1] ?? match?.[2];
  return src ? decodeEntities(src).trim() : trimmed;
}

/** Official Google Maps "Embed a map" iframe URLs, no API key needed. */
export function isApprovedMapEmbedUrl(value: unknown): boolean {
  const url = parseHttpsUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (!GOOGLE_HOST.test(host) && host !== "maps.google.com") return false;
  if (url.pathname.startsWith("/maps/embed")) return true;
  return url.pathname === "/maps" && url.searchParams.get("output") === "embed";
}

const PREVIEW_IMAGE_DOMAINS = [
  "cloudfront.net",
  "strava.com",
  "googleusercontent.com",
  "ggpht.com",
  "gstatic.com",
  "google.com",
];

/** Preview images are only ever hotlinked from known provider/CDN hosts over https. */
export function isAllowedImageUrl(value: unknown): boolean {
  const url = parseHttpsUrl(value);
  if (!url) return false;
  return PREVIEW_IMAGE_DOMAINS.some((d) => hostMatches(url.hostname, d));
}
