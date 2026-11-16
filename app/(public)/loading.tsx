export default function Loading() {
  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 px-4 pt-4"
      role="status"
      aria-label="Loading rides"
    >
      <div className="flex min-h-11 items-center justify-between border-b border-line pb-3">
        <span className="text-sm font-bold uppercase tracking-[0.12em]">
          Ride Board
        </span>
        <span className="label">Loading rides…</span>
      </div>
      <div className="card p-4">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton mt-4 h-6 w-3/4" />
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div className="skeleton h-8" />
          <div className="skeleton h-8" />
        </div>
      </div>
      <div className="card p-4">
        <div className="skeleton h-3 w-28" />
        <div className="skeleton mt-4 h-4 w-2/3" />
        <div className="skeleton mt-4 h-11 w-full" />
      </div>
    </div>
  );
}
