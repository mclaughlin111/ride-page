"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { stravaEmbedSrc } from "@/lib/strava";
import type { StravaEmbed as StravaEmbedData } from "@/lib/types";

const EMBED_ORIGIN = "https://strava-embeds.com";
const subscribe = () => () => {};

/**
 * Strava's official embed, rendered as the same iframe their embed.js builds,
 * so no third-party script runs on this page. Height follows the frame's own
 * resize messages.
 */
export function StravaEmbed({ embed, title }: { embed: StravaEmbedData; title: string }) {
  const ns = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const origin = useSyncExternalStore(subscribe, () => window.location.origin, () => "");
  const path = useSyncExternalStore(subscribe, () => window.location.pathname, () => "");
  const [height, setHeight] = useState(650);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== EMBED_ORIGIN) return;
      const data = event.data;
      if (!Array.isArray(data) || data[0] !== ns || data[1] !== "BROADCAST_IFRAME_HEIGHT") return;
      const next = Number(data[2]);
      if (Number.isFinite(next)) setHeight(Math.min(Math.max(next, 200), 2000));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [ns]);

  if (!origin) return <div className="min-h-[200px]" aria-hidden="true" />;

  return (
    <iframe
      src={stravaEmbedSrc(embed, { ns, origin, path, title })}
      title={title}
      loading="lazy"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="strict-origin-when-cross-origin"
      style={{ height }}
      className="block w-full max-w-[554px] min-w-[250px] border-0"
    />
  );
}
