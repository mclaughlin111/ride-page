import { buildMonthGrid } from "@/lib/rides";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function MiniCalendar({ date, id }: { date: string; id: string }) {
  const { label, weeks, day } = buildMonthGrid(date);
  return (
    <div id={id} className="col-span-2 border border-line-soft p-2" data-testid="mini-calendar">
      <p className="label mb-1 text-center">{label}</p>
      <table className="w-full table-fixed border-collapse text-center text-[11px]" aria-label={label}>
        <thead>
          <tr>
            {WEEKDAYS.map((d, i) => (
              <th key={i} scope="col" className="pb-1 font-medium text-muted">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={w}>
              {week.map((n, i) => (
                <td key={i} className="p-0.5">
                  {n !== null && (
                    <span
                      className={`flex h-6 items-center justify-center ${
                        n === day ? "bg-foreground font-bold text-background" : ""
                      }`}
                      aria-current={n === day ? "date" : undefined}
                    >
                      {n}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
