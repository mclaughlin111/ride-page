"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RideForm } from "./RideForm";
import { LoadError } from "./States";
import { formatRideDate, isComplete, sortRides } from "@/lib/rides";
import type { Ride, RideInput } from "@/lib/types";
import { ROOT_PATH, withBase } from "@/lib/basePath";

function toInput(ride: Ride): RideInput {
  const { id, createdAt, updatedAt, ...input } = ride;
  void id;
  void createdAt;
  void updatedAt;
  return input;
}

type Mode = { kind: "list" } | { kind: "form"; ride?: Ride };

export function AdminDashboard({
  initialRides,
  loadError,
  initialEditId,
  focusField,
}: {
  initialRides: Ride[];
  loadError?: string;
  initialEditId?: string;
  focusField?: string;
}) {
  const router = useRouter();
  const [rides, setRides] = useState<Ride[]>(initialRides);
  // Opened from an Edit link on the public page: return there when done.
  const editTarget = initialEditId
    ? initialRides.find((r) => r.id === initialEditId)
    : undefined;
  const [mode, setMode] = useState<Mode>(
    editTarget ? { kind: "form", ride: editTarget } : { kind: "list" },
  );
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    initialEditId && !editTarget && !loadError
      ? "That ride no longer exists. Pick one from the list."
      : null,
  );
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function request(url: string, init: RequestInit) {
    const response = await fetch(withBase(url), init);
    if (response.status === 401) {
      setExpired(true);
      return null;
    }
    return response;
  }

  async function reload() {
    const response = await fetch(withBase("/api/rides"), { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      setRides(sortRides(data.rides));
    }
  }

  async function toggleComplete(ride: Ride) {
    setBusyId(ride.id);
    setError(null);
    setNotice(null);
    try {
      const input = toInput(ride);
      input.status = isComplete(ride) ? "upcoming" : "complete";
      const response = await request(`/api/rides/${encodeURIComponent(ride.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response) return;
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Could not update the ride. Nothing was changed.");
        return;
      }
      await reload();
      setNotice(
        input.status === "complete" ? "Ride marked as complete." : "Ride reopened.",
      );
    } catch {
      setError("Could not reach the server. Nothing was changed.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(ride: Ride) {
    setBusyId(ride.id);
    setError(null);
    setNotice(null);
    try {
      const response = await request(`/api/rides/${encodeURIComponent(ride.id)}`, {
        method: "DELETE",
      });
      if (!response) return;
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Could not delete the ride.");
        return;
      }
      setConfirmDelete(null);
      await reload();
      setNotice(`Deleted “${ride.title}”.`);
    } catch {
      setError("Could not reach the server. The ride was not deleted.");
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(ride: Ride) {
    const link = `${window.location.origin}${ROOT_PATH}?ride=${encodeURIComponent(ride.id)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(ride.id);
      setTimeout(() => setCopiedId((id) => (id === ride.id ? null : id)), 2000);
    } catch {
      window.prompt("Copy this ride link:", link);
    }
  }

  async function logout() {
    await fetch(withBase("/api/auth/logout"), { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  async function handleDeleted(ride: Ride) {
    if (editTarget) {
      router.push("/");
      router.refresh();
      return;
    }
    setMode({ kind: "list" });
    await reload();
    setNotice(`Deleted “${ride.title}”.`);
  }

  async function handleSaved(ride: Ride) {
    if (editTarget) {
      router.push(`/?ride=${encodeURIComponent(ride.id)}`);
      return;
    }
    setMode({ kind: "list" });
    await reload();
    setNotice(`Saved “${ride.title}”.`);
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 px-4 pb-10 pt-4">
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-line pb-3">
        <span className="text-sm font-bold uppercase tracking-[0.12em]">
          Ride Board · Admin
        </span>
        <div className="flex gap-2">
          <Link href="/" className="btn">
            View
          </Link>
          <button type="button" className="btn" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {expired && (
        <div className="card border-danger p-4" role="alert" data-testid="session-expired">
          <p className="label text-danger">Session expired</p>
          <p className="mt-2 text-sm">
            Your admin session has ended. Nothing was saved. Log in again to continue.
          </p>
          <Link href="/admin/login" className="btn btn-solid mt-3">
            Log in again
          </Link>
        </div>
      )}

      {loadError && <LoadError message={loadError} retryHref={withBase("/admin")} />}
      {error && (
        <p className="card border-danger p-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="card p-3 text-sm" role="status">
          {notice}
        </p>
      )}

      {mode.kind === "form" ? (
        <RideForm
          key={mode.ride?.id ?? "new"}
          ride={mode.ride}
          onSaved={handleSaved}
          onCancel={() =>
            editTarget
              ? router.push(`/?ride=${encodeURIComponent(editTarget.id)}`)
              : setMode({ kind: "list" })
          }
          onSessionExpired={() => setExpired(true)}
          onDeleted={handleDeleted}
          focusField={editTarget && mode.ride?.id === editTarget.id ? focusField : undefined}
        />
      ) : (
        <>
          <button
            type="button"
            className="btn btn-solid"
            onClick={() => {
              setNotice(null);
              setError(null);
              setMode({ kind: "form" });
            }}
            disabled={Boolean(loadError)}
          >
            + Add ride
          </button>

          {rides.length === 0 && !loadError && (
            <div className="card p-6 text-center" data-testid="admin-empty">
              <p className="label">No rides yet</p>
              <p className="mt-2 text-sm text-muted">
                Add the first ride to share with the group.
              </p>
            </div>
          )}

          <ul className="flex flex-col gap-3">
            {rides.map((ride) => {
              const complete = isComplete(ride);
              const busy = busyId === ride.id;
              return (
                <li key={ride.id} className="card flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold uppercase">{ride.title}</p>
                      <p className="mt-1 text-xs text-muted">
                        {formatRideDate(ride.date)} · {ride.time}
                      </p>
                    </div>
                    <span className={`badge shrink-0 ${complete ? "bg-foreground text-background" : ""}`}>
                      {complete ? "Completed" : "Upcoming"}
                    </span>
                  </div>
                  {complete && !ride.stravaPostUrl && (
                    <p className="text-xs text-muted">No Strava post link yet. Edit the ride to add one.</p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className="btn" onClick={() => setMode({ kind: "form", ride })}>
                      Edit
                    </button>
                    <button type="button" className="btn" onClick={() => copyLink(ride)}>
                      {copiedId === ride.id ? "Copied" : "Copy link"}
                    </button>
                    <button type="button" className="btn" onClick={() => toggleComplete(ride)} disabled={busy}>
                      {complete ? "Reopen" : "Mark complete"}
                    </button>
                    {confirmDelete === ride.id ? (
                      <div className="flex gap-2" role="group" aria-label={`Confirm delete ${ride.title}`}>
                        <button type="button" className="btn btn-solid flex-1 px-2" onClick={() => remove(ride)} disabled={busy}>
                          Confirm
                        </button>
                        <button type="button" className="btn flex-1 px-2" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn text-danger hover:text-background" onClick={() => setConfirmDelete(ride.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                  {confirmDelete === ride.id && (
                    <p className="text-xs text-danger" role="alert">
                      Delete this ride permanently? This cannot be undone.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
