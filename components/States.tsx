import Link from "next/link";

export function EmptyState({ isAdmin = false }: { isAdmin?: boolean }) {
  return (
    <div className="card p-6 text-center" data-testid="empty-state">
      <p className="label">No rides yet</p>
      <h1 className="mt-3 text-lg font-bold uppercase">Nothing planned</h1>
      <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
        {isAdmin
          ? "Add the first ride so the group knows where to meet."
          : "No rides have been posted yet. The organiser can add the first one from the admin area."}
      </p>
      <Link href="/admin" className="btn btn-solid mt-5">
        Add the first ride
      </Link>
    </div>
  );
}

export function InvalidRideState({ rideId }: { rideId: string }) {
  return (
    <div className="card p-4" role="alert" data-testid="invalid-ride">
      <p className="label">Ride not found</p>
      <p className="mt-2 break-words text-sm">
        There is no ride with the id <code className="font-bold">{rideId}</code>
        . It may have been deleted, or the link is incorrect.
      </p>
    </div>
  );
}

export function LoadError({
  message,
  retryHref,
}: {
  message?: string;
  retryHref?: string;
}) {
  return (
    <div className="card p-6 text-center" role="alert" data-testid="load-error">
      <p className="label text-danger">Could not load rides</p>
      <p className="mx-auto mt-2 max-w-sm break-words text-sm">
        {message ?? "Something went wrong reading the ride list."}
      </p>
      {retryHref && (
        <a href={retryHref} className="btn btn-solid mt-5">
          Try again
        </a>
      )}
    </div>
  );
}
