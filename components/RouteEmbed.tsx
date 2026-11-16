"use client";

import { useEffect, useState } from "react";

const LOAD_TIMEOUT_MS = 15000;

/**
 * Renders an already-validated provider embed URL in a sandboxed iframe.
 * If the frame has not loaded after a while, a notice is shown; the
 * route link outside this component keeps working either way.
 */
export function RouteEmbed({
  embedUrl,
  title,
  size = "route",
}: {
  embedUrl: string;
  title: string;
  size?: "route" | "map";
}) {
  const box = size === "map" ? "min-h-[200px]" : "min-h-[300px]";
  const frame = size === "map" ? "h-[220px] min-h-[200px]" : "h-[420px] min-h-[300px]";
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loaded]);

  return (
    <div>
      <div className={`relative ${box} border border-line-soft bg-background`}>
        {!loaded && !timedOut && (
          <p
            className="label absolute inset-0 flex items-center justify-center"
            role="status"
          >
            Loading route preview…
          </p>
        )}
        <iframe
          src={embedUrl}
          title={title}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => {
            setLoaded(true);
            setTimedOut(false);
          }}
          className={`block ${frame} w-full border-0`}
        />
      </div>
      {timedOut && !loaded && (
        <p className="mt-2 border border-line-soft p-3 text-xs" role="status">
          The route provider is not responding. The preview may be unavailable
          or blocked. Use the Open link instead.
        </p>
      )}
    </div>
  );
}
