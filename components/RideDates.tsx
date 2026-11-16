"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { MiniCalendar } from "./MiniCalendar";
import { formatRideDate } from "@/lib/rides";

function CalendarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
    >
      <rect x="1.5" y="3" width="13" height="11.5" />
      <path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" />
      <path d="M4.5 9h1M7.5 9h1M10.5 9h1M4.5 11.5h1M7.5 11.5h1" />
    </svg>
  );
}

const iconButton =
  "-my-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center border border-line bg-surface text-foreground hover:bg-foreground hover:text-background";

/**
 * Date and start time. Upcoming rides get a small calendar button: it opens
 * a mini month view, or for admins goes straight to editing the date.
 */
export function RideDates({
  rideId,
  date,
  time,
  timezone,
  showTimezone,
  upcoming,
  isAdmin,
}: {
  rideId: string;
  date: string;
  time: string;
  timezone: string;
  showTimezone: boolean;
  upcoming: boolean;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line-soft pt-3">
      <div>
        <dt className="label">Date</dt>
        <dd className="mt-0.5 flex items-center gap-2 text-sm font-medium leading-6">
          <time dateTime={date}>{formatRideDate(date)}</time>
          {upcoming &&
            (isAdmin ? (
              <Link
                href={`/admin?edit=${encodeURIComponent(rideId)}&focus=date`}
                className={iconButton}
                aria-label="Edit ride date"
              >
                <CalendarIcon />
              </Link>
            ) : (
              <button
                type="button"
                className={iconButton}
                aria-expanded={open}
                aria-controls={panelId}
                aria-label={open ? "Hide calendar" : "Show calendar"}
                onClick={() => setOpen((v) => !v)}
              >
                <CalendarIcon />
              </button>
            ))}
        </dd>
      </div>
      <div>
        <dt className="label">Start</dt>
        <dd className="mt-0.5 text-sm font-medium leading-6">
          <time dateTime={time}>{time}</time>
          {showTimezone && <span className="block text-[11px] text-muted">{timezone}</span>}
        </dd>
      </div>
      {open && !isAdmin && <MiniCalendar date={date} id={panelId} />}
    </dl>
  );
}
