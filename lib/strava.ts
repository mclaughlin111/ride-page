import type { StravaEmbed } from "./types";

const TOKEN = /^[A-Za-z0-9_-]{1,200}$/;
const ID = /^\d{1,20}$/;

function attr(html: string, name: string): string | undefined {
  const match = html.match(
    new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return match?.[1] ?? match?.[2];
}

function build(
  type: string | undefined,
  id: string | undefined,
  token: string | undefined,
  mapHash: string | undefined,
): StravaEmbed | null {
  if (type !== "activity" && type !== "route") return null;
  if (!id || !ID.test(id)) return null;
  if (token && !TOKEN.test(token)) return null;
  if (mapHash && !TOKEN.test(mapHash)) return null;
  return {
    type,
    id,
    ...(token ? { token } : {}),
    ...(mapHash ? { mapHash } : {}),
  };
}

/**
 * Read the values out of Strava's official embed snippet
 * (`<div class="strava-embed-placeholder" data-embed-type=... data-embed-id=... data-token=...>`)
 * or a strava-embeds.com URL. Only the validated values are kept; the snippet
 * and its script tag are never stored or rendered.
 */
export function parseStravaEmbed(input: string): StravaEmbed | null {
  const text = input.trim();
  if (!text) return null;

  if (text.startsWith("<")) {
    if (!/strava-embed-placeholder/i.test(text)) return null;
    return build(
      attr(text, "data-embed-type"),
      attr(text, "data-embed-id"),
      attr(text, "data-token"),
      attr(text, "data-map-hash"),
    );
  }

  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.hostname !== "strava-embeds.com") return null;
    const match = url.pathname.match(/^\/(activity|route)\/(\d+)\/?$/);
    if (!match) return null;
    return build(
      match[1],
      match[2],
      url.searchParams.get("token") ?? undefined,
      new URLSearchParams(url.hash.slice(1)).get("mapHash") ?? undefined,
    );
  } catch {
    return null;
  }
}

/** Canonical text form shown back to the admin when editing. */
export function stravaEmbedToSnippet(embed: StravaEmbed): string {
  const parts = [
    'class="strava-embed-placeholder"',
    `data-embed-type="${embed.type}"`,
    `data-embed-id="${embed.id}"`,
    'data-style="standard"',
    ...(embed.mapHash ? [`data-map-hash="${embed.mapHash}"`] : []),
    ...(embed.token ? [`data-token="${embed.token}"`] : []),
  ];
  return `<div ${parts.join(" ")}></div>`;
}

/** Same iframe URL that Strava's embed.js builds, without loading its script. */
export function stravaEmbedSrc(
  embed: StravaEmbed,
  host: { ns: string; origin: string; path: string; title: string },
): string {
  const query = new URLSearchParams({ style: "standard", fromEmbed: "false" });
  if (embed.token) query.set("token", embed.token);
  const hash = new URLSearchParams({
    ns: host.ns,
    hostOrigin: host.origin,
    hostPath: host.path,
    hostTitle: host.title,
  });
  const mapHash = embed.mapHash ? `&mapHash=${embed.mapHash}` : "";
  return `https://strava-embeds.com/${embed.type}/${embed.id}?${query}#${hash}${mapHash}`;
}
