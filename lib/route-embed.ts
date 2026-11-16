import { hostMatches, parseHttpsUrl } from "./urls";
import type { RideRoute, RouteProvider } from "./types";

export type RouteEmbedResult = {
  provider: string;
  embedUrl?: string;
  canEmbed: boolean;
  fallbackUrl: string;
};

type ProviderAdapter = {
  provider: RouteProvider;
  /** True when the share URL belongs to this provider. */
  matchesHost: (url: URL) => boolean;
  /** True when the URL is an official embed (iframe src) for this provider. */
  isApprovedEmbedUrl: (url: URL) => boolean;
  /** Build an embed URL from a public share URL, without any network access. */
  deriveEmbedUrl?: (url: URL) => string | undefined;
};

const ridewithgps: ProviderAdapter = {
  provider: "ridewithgps",
  matchesHost: (url) => hostMatches(url.hostname, "ridewithgps.com"),
  isApprovedEmbedUrl: (url) =>
    hostMatches(url.hostname, "ridewithgps.com") && url.pathname === "/embeds",
  deriveEmbedUrl: (url) => {
    const match = url.pathname.match(/^\/(routes|trips)\/(\d+)\/?$/);
    if (!match) return undefined;
    const embed = new URL("https://ridewithgps.com/embeds");
    embed.searchParams.set("type", match[1] === "routes" ? "route" : "trip");
    embed.searchParams.set("id", match[2]);
    embed.searchParams.set("sampleGraph", "true");
    const privacyCode = url.searchParams.get("privacy_code");
    if (privacyCode) embed.searchParams.set("privacyCode", privacyCode);
    return embed.toString();
  },
};

// Strava embeds need a token from Strava's own share dialog, so they can only
// be rendered when an official embed URL is supplied.
const strava: ProviderAdapter = {
  provider: "strava",
  matchesHost: (url) =>
    hostMatches(url.hostname, "strava.com") || url.hostname === "strava.app.link",
  isApprovedEmbedUrl: (url) =>
    (hostMatches(url.hostname, "strava.com") &&
      /^\/(activities|routes)\/[\w-]+\/embed\/\w+\/?$/.test(url.pathname)) ||
    url.hostname === "strava-embeds.com",
};

const komoot: ProviderAdapter = {
  provider: "komoot",
  matchesHost: (url) =>
    hostMatches(url.hostname, "komoot.com") ||
    hostMatches(url.hostname, "komoot.de"),
  isApprovedEmbedUrl: (url) =>
    hostMatches(url.hostname, "komoot.com") &&
    /^\/([a-z]{2}(-[a-z]{2})?\/)?tour\/\d+\/embed\/?$/i.test(url.pathname),
  deriveEmbedUrl: (url) => {
    const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?tour\/(\d+)\/?$/i);
    if (!match) return undefined;
    const embed = new URL(`https://www.komoot.com/tour/${match[1]}/embed`);
    const shareToken = url.searchParams.get("share_token");
    if (shareToken) embed.searchParams.set("share_token", shareToken);
    embed.searchParams.set("profile", "1");
    return embed.toString();
  },
};

// Garmin has no stable public embed format; only an explicit official URL is used.
const garmin: ProviderAdapter = {
  provider: "garmin",
  matchesHost: (url) => hostMatches(url.hostname, "garmin.com"),
  isApprovedEmbedUrl: (url) => url.hostname === "connect.garmin.com",
};

const other: ProviderAdapter = {
  provider: "other",
  matchesHost: () => true,
  isApprovedEmbedUrl: () => false,
};

export const ADAPTERS: Record<RouteProvider, ProviderAdapter> = {
  ridewithgps,
  strava,
  komoot,
  garmin,
  other,
};

const DETECTION_ORDER: RouteProvider[] = [
  "ridewithgps",
  "strava",
  "komoot",
  "garmin",
];

export function detectProvider(value: string): RouteProvider {
  const url = parseHttpsUrl(value);
  if (!url) return "other";
  for (const provider of DETECTION_ORDER) {
    if (ADAPTERS[provider].matchesHost(url)) return provider;
  }
  return "other";
}

/** An embed URL is only accepted when it is https and on an approved provider domain. */
export function isApprovedEmbedUrl(value: string): boolean {
  const url = parseHttpsUrl(value);
  if (!url) return false;
  return DETECTION_ORDER.some((p) => ADAPTERS[p].isApprovedEmbedUrl(url));
}

/** Check an embed URL against one specific provider's approved patterns. */
export function isApprovedEmbedUrlFor(
  provider: RouteProvider,
  value: string,
): boolean {
  const url = parseHttpsUrl(value);
  return url ? ADAPTERS[provider].isApprovedEmbedUrl(url) : false;
}

export function getRouteEmbed(route: RideRoute): RouteEmbedResult {
  const base = { provider: route.provider, fallbackUrl: route.url };
  const adapter = ADAPTERS[route.provider] ?? other;

  if (route.embedUrl && isApprovedEmbedUrl(route.embedUrl)) {
    return { ...base, embedUrl: route.embedUrl, canEmbed: true };
  }

  const shareUrl = parseHttpsUrl(route.url);
  if (shareUrl && adapter.deriveEmbedUrl && adapter.matchesHost(shareUrl)) {
    const derived = adapter.deriveEmbedUrl(shareUrl);
    if (derived && isApprovedEmbedUrl(derived)) {
      return { ...base, embedUrl: derived, canEmbed: true };
    }
  }

  return { ...base, canEmbed: false };
}
