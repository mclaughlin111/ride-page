"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RideCard } from "./RideCard";
import { EmptyState, InvalidRideState } from "./States";
import {
  clampIndex,
  findRideIndex,
  nextIndex,
  prevIndex,
  swipeDirection,
} from "@/lib/rides";
import type { Ride } from "@/lib/types";
import { ROOT_PATH } from "@/lib/basePath";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

function ArrowButton({
  direction,
  disabled,
  onClick,
  label,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  const side =
    direction === "prev"
      ? "left-0 lg:left-[calc(50%-21.5rem)]"
      : "right-0 lg:right-[calc(50%-21.5rem)]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`btn fixed top-1/2 z-10 h-11 w-7 -translate-y-1/2 px-0 text-base lg:w-11 ${side}`}
    >
      <span aria-hidden="true">{direction === "prev" ? "←" : "→"}</span>
    </button>
  );
}

export function RideBoard({
  rides,
  initialRideId,
  isAdmin = false,
}: {
  rides: Ride[];
  initialRideId?: string;
  isAdmin?: boolean;
}) {
  const initialIndex = findRideIndex(rides, initialRideId);
  const [index, setIndex] = useState(Math.max(initialIndex, 0));
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);
  const [invalidId, setInvalidId] = useState<string | undefined>(
    initialRideId && initialIndex === -1 ? initialRideId : undefined,
  );
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const count = rides.length;
  const current = clampIndex(index, count);
  const ride = rides[current];
  const hasMultiple = count > 1;

  const goTo = useCallback(
    (target: number) => {
      if (target === current || !rides[target]) return;
      setDirection(target > current ? "next" : "prev");
      setIndex(target);
      setInvalidId(undefined);
      window.history.replaceState(
        null,
        "",
        `${ROOT_PATH}?ride=${encodeURIComponent(rides[target].id)}`,
      );
    },
    [current, rides],
  );

  const goNext = useCallback(
    () => goTo(nextIndex(current, count)),
    [goTo, current, count],
  );
  const goPrev = useCallback(
    () => goTo(prevIndex(current, count)),
    [goTo, current, count],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowRight") goNext();
      else if (event.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev]);

  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function onTouchEnd(event: React.TouchEvent) {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !touch) return;
    const step = swipeDirection(touch.clientX - start.x, touch.clientY - start.y);
    if (step === 1) goNext();
    else if (step === -1) goPrev();
  }

  return (
    <div
      className={`mx-auto flex min-h-[calc(100dvh-1.75rem)] w-full max-w-xl flex-col pb-6 pt-4 sm:px-4 ${hasMultiple ? "px-8" : "px-4"}`}
    >
      <header className="mb-4 flex min-h-11 items-center justify-between border-b border-line pb-3">
        <span className="text-sm font-bold uppercase tracking-[0.12em]">
          Ride Board
        </span>
        {count > 0 && (
          <p
            className="border border-line px-2 py-1 text-xs font-medium"
            aria-label={`Ride ${current + 1} of ${count}`}
          >
            {current + 1} / {count}
          </p>
        )}
      </header>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {ride ? `Ride ${current + 1} of ${count}: ${ride.title}` : ""}
      </p>

      <main
        className="flex-1 touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {invalidId && (
          <div className="mb-4 flex flex-col gap-3">
            <InvalidRideState rideId={invalidId} />
            {count > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setInvalidId(undefined);
                  window.history.replaceState(null, "", ROOT_PATH);
                }}
              >
                Show the rides
              </button>
            )}
          </div>
        )}

        {count === 0 ? (
          <EmptyState />
        ) : (
          !invalidId &&
          ride && (
            <div
              key={ride.id}
              className={
                direction === "next"
                  ? "slide-next"
                  : direction === "prev"
                    ? "slide-prev"
                    : undefined
              }
            >
              <RideCard ride={ride} isAdmin={isAdmin} />
            </div>
          )
        )}
      </main>

      {hasMultiple && !invalidId && (
        <nav aria-label="Ride navigation">
          <ArrowButton
            direction="prev"
            disabled={current === 0}
            onClick={goPrev}
            label="Previous ride"
          />
          <ArrowButton
            direction="next"
            disabled={current === count - 1}
            onClick={goNext}
            label="Next ride"
          />
        </nav>
      )}

      <footer className="mt-8 flex justify-center">
        <Link
          href="/admin"
          className="inline-flex min-h-11 items-center px-3 text-[11px] uppercase tracking-[0.08em] text-muted underline-offset-4 hover:underline"
        >
          Admin
        </Link>
      </footer>
    </div>
  );
}
