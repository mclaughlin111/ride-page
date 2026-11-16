import { RouteEmbed } from "./RouteEmbed";
import { getRouteEmbed } from "@/lib/route-embed";
import { PROVIDER_LABELS, type RideRoute } from "@/lib/types";
import { parseHttpsUrl } from "@/lib/urls";

export function RouteSection({
  route,
  rideTitle,
}: {
  route?: RideRoute;
  rideTitle: string;
}) {
  if (!route) {
    return (
      <section aria-labelledby="route-heading" className="card px-4 py-3">
        <h2 id="route-heading" className="label">
          Route
        </h2>
        <p className="mt-0.5 text-sm text-muted">No route added yet.</p>
      </section>
    );
  }

  const providerLabel = PROVIDER_LABELS[route.provider] ?? "Other";
  const safeUrl = parseHttpsUrl(route.url);

  if (!safeUrl) {
    return (
      <section aria-labelledby="route-heading" className="card px-4 py-3">
        <h2 id="route-heading" className="label">
          Route · {providerLabel}
        </h2>
        <p className="mt-1 text-sm text-danger" role="alert">
          This route link is invalid, so it cannot be opened. Ask the organiser
          to fix it.
        </p>
      </section>
    );
  }

  const embed = getRouteEmbed({ ...route, url: safeUrl.href });

  return (
    <section aria-labelledby="route-heading" className="card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="route-heading" className="label">
            Route
          </h2>
          <p className="mt-0.5 text-sm font-medium">{providerLabel}</p>
        </div>
        <a
          className="btn btn-solid shrink-0"
          href={embed.fallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open route
        </a>
      </div>

      <div className="mt-3">
        {embed.canEmbed && embed.embedUrl ? (
          <RouteEmbed
            key={embed.embedUrl}
            embedUrl={embed.embedUrl}
            title={`${providerLabel} route preview for ${rideTitle}`}
          />
        ) : (
          <p
            className="border border-dashed border-line-soft p-3 text-xs text-muted"
            data-testid="route-fallback"
          >
            {route.provider === "garmin"
              ? "Garmin routes open as a normal link. A preview needs an official public embed URL."
              : route.provider === "strava"
                ? "Strava previews need an official embed URL for a public route or activity."
                : `No inline preview for this ${providerLabel} link. Use Open route.`}
          </p>
        )}
      </div>
    </section>
  );
}
