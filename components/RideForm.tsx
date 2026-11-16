"use client";

import { useRef, useState } from "react";
import { detectProvider } from "@/lib/route-embed";
import { stravaEmbedToSnippet } from "@/lib/strava";
import {
  DEFAULT_TIMEZONE,
  PROVIDER_LABELS,
  ROUTE_PROVIDERS,
  type FieldErrors,
  type Ride,
} from "@/lib/types";
import { withBase } from "@/lib/basePath";

type StopDraft = {
  key: string;
  id?: string;
  name: string;
  description: string;
  mapUrl: string;
};

type FormState = {
  title: string;
  date: string;
  time: string;
  timezone: string;
  meetingName: string;
  meetingAddress: string;
  meetingMapUrl: string;
  meetingEmbedUrl: string;
  provider: string;
  routeUrl: string;
  embedUrl: string;
  comments: string;
  complete: boolean;
  stravaPostUrl: string;
  stravaEmbed: string;
};

function initialState(ride?: Ride): FormState {
  return {
    title: ride?.title ?? "",
    date: ride?.date ?? "",
    time: ride?.time ?? "",
    timezone: ride?.timezone ?? DEFAULT_TIMEZONE,
    meetingName: ride?.meetingLocation?.name ?? "",
    meetingAddress: ride?.meetingLocation?.address ?? "",
    meetingMapUrl: ride?.meetingLocation?.mapUrl ?? "",
    meetingEmbedUrl: ride?.meetingLocation?.embedUrl ?? "",
    provider: ride?.route?.provider ?? "auto",
    routeUrl: ride?.route?.url ?? "",
    embedUrl: ride?.route?.embedUrl ?? "",
    comments: ride?.comments ?? "",
    complete: ride?.status === "complete",
    stravaPostUrl: ride?.stravaPostUrl ?? "",
    stravaEmbed: ride?.stravaEmbed ? stravaEmbedToSnippet(ride.stravaEmbed) : "",
  };
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, error?: string, hasHint?: boolean) {
  return [hasHint ? `${id}-hint` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ") || undefined;
}

export function RideForm({
  ride,
  onSaved,
  onCancel,
  onSessionExpired,
  onDeleted,
  focusField,
}: {
  onDeleted?: (ride: Ride) => void;
  focusField?: string;
  ride?: Ride;
  onSaved: (ride: Ride) => void;
  onCancel: () => void;
  onSessionExpired: () => void;
}) {
  const keyCounter = useRef(0);
  const nextKey = () => `stop-${keyCounter.current++}`;

  const [form, setForm] = useState<FormState>(() => initialState(ride));
  const [stops, setStops] = useState<StopDraft[]>(() =>
    (ride?.stops ?? []).map((s) => ({
      key: `existing-${s.id}`,
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      mapUrl: s.mapUrl ?? "",
    })),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteRide() {
    if (!ride) return;
    setDeleting(true);
    setSaveError(null);
    try {
      const response = await fetch(withBase(`/api/rides/${encodeURIComponent(ride.id)}`), {
        method: "DELETE",
      });
      if (response.status === 401) {
        onSessionExpired();
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setSaveError(data.error ?? "The ride could not be deleted. Please try again.");
        setConfirmingDelete(false);
        return;
      }
      onDeleted?.(ride);
    } catch {
      setSaveError("Could not reach the server. The ride was not deleted.");
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateStop(index: number, patch: Partial<StopDraft>) {
    setStops((list) => list.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function moveStop(index: number, delta: -1 | 1) {
    setStops((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const copy = [...list];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }

  const detected = form.routeUrl ? detectProvider(form.routeUrl) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setErrors({});

    const payload = {
      title: form.title,
      date: form.date,
      time: form.time,
      timezone: form.timezone,
      meetingLocation: {
        name: form.meetingName,
        address: form.meetingAddress,
        mapUrl: form.meetingMapUrl,
        embedUrl: form.meetingEmbedUrl,
      },
      route: {
        provider: form.provider,
        url: form.routeUrl,
        embedUrl: form.embedUrl,
      },
      comments: form.comments,
      stops: stops.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        mapUrl: s.mapUrl,
      })),
      status: form.complete ? "complete" : "upcoming",
      stravaPostUrl: form.stravaPostUrl,
      stravaEmbed: form.stravaEmbed,
    };

    try {
      const response = await fetch(
        withBase(ride ? `/api/rides/${encodeURIComponent(ride.id)}` : "/api/rides"),
        {
          method: ride ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (response.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (response.status === 400 && data.errors) {
        setErrors(data.errors);
        setSaveError("Some fields need attention. Fix the errors below and save again.");
        return;
      }
      if (!response.ok) {
        setSaveError(data.error ?? "The ride could not be saved. Please try again.");
        return;
      }
      onSaved(data.ride);
    } catch {
      setSaveError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const textField = (
    id: string,
    errorKey: string,
    value: string,
    onChange: (v: string) => void,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
    hasHint = false,
  ) => (
    <input
      id={id}
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={errors[errorKey] ? true : undefined}
      aria-describedby={describedBy(id, errors[errorKey], hasHint)}
      autoFocus={focusField === id}
      {...extra}
    />
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-label={ride ? "Edit ride" : "Add ride"}>
      <h2 className="text-base font-bold uppercase">
        {ride ? "Edit ride" : "Add ride"}
      </h2>

      {saveError && (
        <p className="card border-danger p-3 text-sm text-danger" role="alert">
          {saveError}
        </p>
      )}

      <Field id="title" label="Ride title" error={errors.title}>
        {textField("title", "title", form.title, (v) => set("title", v), {
          maxLength: 120,
          autoComplete: "off",
        })}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field id="date" label="Date" error={errors.date}>
          {textField("date", "date", form.date, (v) => set("date", v), { type: "date" })}
        </Field>
        <Field id="time" label="Start time (24h)" error={errors.time}>
          {textField("time", "time", form.time, (v) => set("time", v), { type: "time" })}
        </Field>
      </div>

      <Field
        id="timezone"
        label="Timezone"
        error={errors.timezone}
        hint="IANA name, for example Europe/London."
      >
        {textField(
          "timezone",
          "timezone",
          form.timezone,
          (v) => set("timezone", v),
          { autoComplete: "off", autoCapitalize: "off" },
          true,
        )}
      </Field>

      <fieldset className="card flex flex-col gap-4 p-4">
        <legend className="label bg-background px-1">Meeting location (optional)</legend>
        <Field
          id="meetingName"
          label="Location name"
          error={errors["meetingLocation.name"]}
          hint="Leave all meeting fields empty if the start point is not decided yet."
        >
          {textField("meetingName", "meetingLocation.name", form.meetingName, (v) => set("meetingName", v), { maxLength: 120 }, true)}
        </Field>
        <Field id="meetingAddress" label="Address" error={errors["meetingLocation.address"]}>
          {textField("meetingAddress", "meetingLocation.address", form.meetingAddress, (v) => set("meetingAddress", v), { maxLength: 240 })}
        </Field>
        <Field
          id="meetingMapUrl"
          label="Google Maps link"
          error={errors["meetingLocation.mapUrl"]}
          hint="Any Maps link, including short maps.app.goo.gl links. Leave blank to link to a Maps search for the name and address."
        >
          {textField("meetingMapUrl", "meetingLocation.mapUrl", form.meetingMapUrl, (v) => set("meetingMapUrl", v), { type: "url", inputMode: "url", placeholder: "https://maps.app.goo.gl/…" }, true)}
        </Field>
        <Field
          id="meetingEmbedUrl"
          label="Map embed (optional)"
          error={errors["meetingLocation.embedUrl"]}
          hint="In Google Maps choose Share > Embed a map, then paste the iframe code or just its src URL. Shows a small map on the ride page."
        >
          <textarea
            id="meetingEmbedUrl"
            className="input min-h-20 font-mono text-xs"
            value={form.meetingEmbedUrl}
            onChange={(e) => set("meetingEmbedUrl", e.target.value)}
            placeholder='<iframe src="https://www.google.com/maps/embed?…"></iframe>'
            aria-invalid={errors["meetingLocation.embedUrl"] ? true : undefined}
            aria-describedby={describedBy("meetingEmbedUrl", errors["meetingLocation.embedUrl"], true)}
          />
        </Field>
      </fieldset>

      <fieldset className="card flex flex-col gap-4 p-4">
        <legend className="label bg-background px-1">Route</legend>
        <Field
          id="routeUrl"
          label="Route / share link"
          error={errors["route.url"]}
          hint={
            detected
              ? `Detected provider: ${PROVIDER_LABELS[detected]}.`
              : "Ride with GPS, Strava, Garmin, Komoot or any https:// link."
          }
        >
          {textField("routeUrl", "route.url", form.routeUrl, (v) => set("routeUrl", v), { type: "url", inputMode: "url", placeholder: "https://ridewithgps.com/routes/…" }, true)}
        </Field>
        <Field id="provider" label="Route provider" error={errors["route.provider"]}>
          <select
            id="provider"
            className="input"
            value={form.provider}
            onChange={(e) => set("provider", e.target.value)}
          >
            <option value="auto">Auto-detect from link</option>
            {ROUTE_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="embedUrl"
          label="Embed URL (optional)"
          error={errors["route.embedUrl"]}
          hint="Paste the iframe code or just its src URL from the provider's official embed or share dialog. Only the src is kept, and only approved provider domains are accepted."
        >
          {textField("embedUrl", "route.embedUrl", form.embedUrl, (v) => set("embedUrl", v), { type: "url", inputMode: "url", placeholder: "https://…" }, true)}
        </Field>
      </fieldset>

      <Field id="comments" label="Comments" error={errors.comments}>
        <textarea
          id="comments"
          className="input min-h-28"
          value={form.comments}
          onChange={(e) => set("comments", e.target.value)}
          maxLength={2000}
          aria-invalid={errors.comments ? true : undefined}
          aria-describedby={describedBy("comments", errors.comments)}
        />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="label mb-2">Stops</legend>
        {errors.stops && (
          <p className="text-xs font-medium text-danger" role="alert">
            {errors.stops}
          </p>
        )}
        {stops.length === 0 && (
          <p className="text-xs text-muted">No stops yet. Add a cafe or other stop.</p>
        )}
        {stops.map((stop, i) => (
          <div key={stop.key} className="card flex flex-col gap-3 p-4" role="group" aria-label={`Stop ${i + 1}`}>
            <p className="label">Stop {i + 1}</p>
            <Field id={`stop-${i}-name`} label="Name" error={errors[`stops.${i}.name`]}>
              {textField(`stop-${i}-name`, `stops.${i}.name`, stop.name, (v) => updateStop(i, { name: v }), { maxLength: 120 })}
            </Field>
            <Field id={`stop-${i}-description`} label="Description" error={errors[`stops.${i}.description`]}>
              {textField(`stop-${i}-description`, `stops.${i}.description`, stop.description, (v) => updateStop(i, { description: v }), { maxLength: 500 })}
            </Field>
            <Field id={`stop-${i}-mapUrl`} label="Google Maps link" error={errors[`stops.${i}.mapUrl`]}>
              {textField(`stop-${i}-mapUrl`, `stops.${i}.mapUrl`, stop.mapUrl, (v) => updateStop(i, { mapUrl: v }), { type: "url", inputMode: "url" })}
            </Field>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => moveStop(i, -1)} disabled={i === 0} aria-label={`Move stop ${i + 1} up`}>
                Up
              </button>
              <button type="button" className="btn" onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} aria-label={`Move stop ${i + 1} down`}>
                Down
              </button>
              <button type="button" className="btn" onClick={() => setStops((l) => l.filter((_, n) => n !== i))} aria-label={`Remove stop ${i + 1}`}>
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          onClick={() =>
            setStops((l) => [...l, { key: nextKey(), name: "", description: "", mapUrl: "" }])
          }
        >
          + Add stop
        </button>
      </fieldset>

      <div className="card flex flex-col gap-4 p-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-foreground"
            checked={form.complete}
            onChange={(e) => set("complete", e.target.checked)}
          />
          <span className="label text-foreground">Ride completed</span>
        </label>
        {form.complete && (
          <Field
            id="stravaPostUrl"
            label="Strava post link"
            error={errors.stravaPostUrl}
            hint="Optional. Shown on the public page for completed rides."
          >
            {textField("stravaPostUrl", "stravaPostUrl", form.stravaPostUrl, (v) => set("stravaPostUrl", v), { type: "url", inputMode: "url", placeholder: "https://www.strava.com/activities/…" }, true)}
          </Field>
        )}
        {form.complete && (
          <Field
            id="stravaEmbed"
            label="Strava embed (optional)"
            error={errors.stravaEmbed}
            hint="On the Strava activity choose Share > Embed on Your Site and paste the code. Only the activity id and token are kept; Strava's script is not loaded. Without it, a map image is fetched from the post link when available."
          >
            <textarea
              id="stravaEmbed"
              className="input min-h-20 font-mono text-xs"
              value={form.stravaEmbed}
              onChange={(e) => set("stravaEmbed", e.target.value)}
              placeholder='<div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="…"></div>'
              aria-invalid={errors.stravaEmbed ? true : undefined}
              aria-describedby={describedBy("stravaEmbed", errors.stravaEmbed, true)}
            />
          </Field>
        )}
      </div>

      {errors._form && (
        <p className="text-sm text-danger" role="alert">
          {errors._form}
        </p>
      )}

      <div className="flex gap-3">
        <button type="submit" className="btn btn-solid flex-1" disabled={saving}>
          {saving ? "Saving…" : ride ? "Save changes" : "Add ride"}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={saving || deleting}>
          Cancel
        </button>
      </div>

      {ride && (
        <div className="border-t border-line-soft pt-5">
          {confirmingDelete ? (
            <div className="flex flex-col gap-3" role="group" aria-label="Confirm delete">
              <p className="text-sm text-danger" role="alert">
                Delete “{ride.title}” permanently? This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="btn btn-danger flex-1"
                  onClick={deleteRide}
                  disabled={deleting}
                >
                  {deleting ? "Deleting…" : "Yes, delete ride"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                >
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger w-full"
              onClick={() => setConfirmingDelete(true)}
              disabled={saving}
            >
              Delete ride
            </button>
          )}
        </div>
      )}
    </form>
  );
}
