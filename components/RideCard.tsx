import Link from "next/link";
import { MapButton } from "./MapButton";
import { PreviewImage } from "./PreviewImage";
import { RideDates } from "./RideDates";
import { RouteEmbed } from "./RouteEmbed";
import { RouteSection } from "./RouteSection";
import { StravaEmbed } from "./StravaEmbed";
import { getStravaPostUrl, isComplete } from "@/lib/rides";
import { DEFAULT_TIMEZONE, type Ride } from "@/lib/types";
import { isApprovedMapEmbedUrl, parseHttpsUrl, resolveMapsUrl } from "@/lib/urls";

export function RideCard({ ride, isAdmin = false }: { ride: Ride; isAdmin?: boolean }) {
  const complete = isComplete(ride);
  const stravaUrl = getStravaPostUrl(ride);
  const safeStravaUrl = stravaUrl ? parseHttpsUrl(stravaUrl) : null;
  const stravaEmbed = complete ? ride.stravaEmbed : undefined;
  const stravaImage = complete && !stravaEmbed ? ride.stravaImageUrl : undefined;
  const timezone = ride.timezone ?? DEFAULT_TIMEZONE;
  const meeting = ride.meetingLocation;
  const hasStravaPost = Boolean(safeStravaUrl || stravaEmbed);

  return (
    <article
      className="flex flex-col gap-3"
      aria-labelledby={`ride-title-${ride.id}`}
      data-testid="ride-card"
    >
      <header className="card px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className={`badge ${complete ? "bg-foreground text-background" : ""}`}>
            {complete ? "Completed" : "Upcoming"}
          </span>
          {isAdmin && (
            <Link
              href={`/admin?edit=${encodeURIComponent(ride.id)}`}
              className="badge bg-surface no-underline hover:bg-foreground hover:text-background"
              aria-label={`Edit ${ride.title}`}
            >
              Edit
            </Link>
          )}
        </div>
        <h1
          id={`ride-title-${ride.id}`}
          className="mt-2 break-words text-xl font-bold uppercase leading-tight tracking-tight"
        >
          {ride.title}
        </h1>
        <RideDates
          rideId={ride.id}
          date={ride.date}
          time={ride.time}
          timezone={timezone}
          showTimezone={timezone !== DEFAULT_TIMEZONE}
          upcoming={!complete}
          isAdmin={isAdmin}
        />
      </header>

      <RouteSection route={ride.route} rideTitle={ride.title} />

      {complete && (
        <section aria-label="Ride result" className="card px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="label">Strava post</p>
              <p className="mt-0.5 text-sm">
                {hasStravaPost
                  ? "This ride has been posted."
                  : "No Strava post has been added for this ride yet."}
              </p>
            </div>
            {safeStravaUrl && (
              <a
                className="btn btn-solid shrink-0"
                href={safeStravaUrl.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Strava
              </a>
            )}
          </div>
          {stravaEmbed && (
            <div className="mt-3">
              <StravaEmbed embed={stravaEmbed} title={`Strava post for ${ride.title}`} />
            </div>
          )}
          {stravaImage && safeStravaUrl && (
            <a
              href={safeStravaUrl.href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block"
              aria-label="Open the Strava post"
            >
              <PreviewImage
                src={stravaImage}
                alt={`Map from the Strava post for ${ride.title}`}
                className="block max-h-56 w-full border border-line-soft object-cover"
              />
            </a>
          )}
        </section>
      )}

      {meeting && (
        <section aria-labelledby="meeting-heading" className="card">
          <div className="flex items-center justify-between bg-foreground px-4 py-1.5 text-background">
            <h2
              id="meeting-heading"
              className="text-[11px] font-medium uppercase tracking-[0.08em]"
            >
              Meeting point
            </h2>
            <span aria-hidden="true" className="text-[11px]">
              START
            </span>
          </div>
          <div className="flex flex-col gap-2 px-4 py-3">
            <div>
              <p className="break-words text-sm font-medium">{meeting.name}</p>
              {meeting.address && (
                <p className="mt-0.5 break-words text-xs text-muted">{meeting.address}</p>
              )}
            </div>
            {meeting.embedUrl && isApprovedMapEmbedUrl(meeting.embedUrl) && (
              <RouteEmbed
                embedUrl={meeting.embedUrl}
                title={`Map of ${meeting.name}`}
                size="map"
              />
            )}
            <MapButton mapUrl={meeting.mapUrl} name={meeting.name} address={meeting.address} />
          </div>
        </section>
      )}

      {ride.comments && (
        <section aria-labelledby="comments-heading" className="card px-4 py-3">
          <h2 id="comments-heading" className="label">
            Comments
          </h2>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{ride.comments}</p>
        </section>
      )}

      {ride.stops.length > 0 && (
        <section aria-labelledby="stops-heading">
          <h2 id="stops-heading" className="label mb-2">
            Stops · cafe &amp; more
          </h2>
          <ol className="flex flex-col">
            {ride.stops.map((stop, i) => (
              <li key={stop.id} className="relative flex gap-3">
                <div className="flex flex-col items-center" aria-hidden="true">
                  <span className="mt-3 flex h-6 w-6 shrink-0 items-center justify-center border border-line bg-surface text-[11px] font-medium">
                    {i + 1}
                  </span>
                  {i < ride.stops.length - 1 && <span className="w-px flex-1 bg-line" />}
                </div>
                <div className="card mb-3 flex min-w-0 flex-1 items-stretch justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div>
                      <p className="break-words text-sm font-medium">
                        <span className="sr-only">Stop {i + 1}: </span>
                        {stop.name}
                      </p>
                      {stop.description && (
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted">
                          {stop.description}
                        </p>
                      )}
                    </div>
                    <MapButton mapUrl={stop.mapUrl} name={stop.name} />
                  </div>
                  {stop.imageUrl && (
                    <a
                      href={resolveMapsUrl(stop.mapUrl, stop.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      tabIndex={-1}
                      aria-hidden="true"
                      className="shrink-0 self-start"
                    >
                      <PreviewImage
                        src={stop.imageUrl}
                        alt=""
                        className="block h-24 w-24 border border-line-soft object-cover"
                      />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
