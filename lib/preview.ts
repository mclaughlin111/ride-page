import { hostMatches, isAllowedImageUrl, parseHttpsUrl } from "./urls";
import type { Ride, RideInput } from "./types";

const PAGE_DOMAINS = [
  "strava.com",
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "google.co.uk",
];
const MAX_REDIRECTS = 4;
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 5000;

function isAllowedPage(url: URL): boolean {
  return PAGE_DOMAINS.some((d) => hostMatches(url.hostname, d));
}

function decode(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** Find og:image / twitter:image in the page head. */
export function extractImageFromHtml(html: string, pageUrl: string): string | undefined {
  const found: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i);
    const value = content?.[1] ?? content?.[2];
    if (key && value && !(key in found)) found[key] = decode(value);
  }
  const candidate = found["og:image"] ?? found["og:image:url"] ?? found["twitter:image"];
  if (!candidate) return undefined;
  try {
    const resolved = new URL(candidate, pageUrl).href;
    return isAllowedImageUrl(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

async function readHead(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      text += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(text)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

/**
 * Look up the preview image (Open Graph) for a Strava or Google Maps link.
 * Only https pages on known hosts are fetched, every redirect hop is checked
 * against the same list, and failures simply return undefined.
 */
export async function fetchPreviewImage(link: string): Promise<string | undefined> {
  let url = parseHttpsUrl(link);
  if (!url || !isAllowedPage(url)) return undefined;

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetch(url, {
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; RideBoardBot/1.0)",
          Accept: "text/html",
          "Accept-Language": "en-GB,en;q=0.8",
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) return undefined;
        const next = parseHttpsUrl(new URL(location, url).href);
        if (!next || !isAllowedPage(next)) return undefined;
        url = next;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return undefined;
      }
      const type = response.headers.get("content-type") ?? "";
      if (!type.includes("text/html")) {
        await response.body?.cancel().catch(() => {});
        return undefined;
      }
      return extractImageFromHtml(await readHead(response), url.href);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Attach preview images to a validated ride. Existing images are reused when
 * the source link has not changed, so editing a ride does not refetch.
 */
export async function attachPreviewImages(
  input: RideInput,
  existing?: Ride,
): Promise<RideInput> {
  const stops = await Promise.all(
    input.stops.map(async (stop) => {
      if (!stop.mapUrl) return stop;
      const before = existing?.stops.find((s) => s.id === stop.id);
      const reuse = before?.mapUrl === stop.mapUrl ? before.imageUrl : undefined;
      const imageUrl = reuse ?? (await fetchPreviewImage(stop.mapUrl));
      return imageUrl ? { ...stop, imageUrl } : stop;
    }),
  );

  let stravaImageUrl: string | undefined;
  if (input.status === "complete" && input.stravaPostUrl) {
    stravaImageUrl =
      existing?.stravaPostUrl === input.stravaPostUrl && existing.stravaImageUrl
        ? existing.stravaImageUrl
        : await fetchPreviewImage(input.stravaPostUrl);
  }

  return { ...input, stops, ...(stravaImageUrl ? { stravaImageUrl } : {}) };
}
