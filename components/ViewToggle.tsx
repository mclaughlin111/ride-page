"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setTheme, useTheme } from "@/lib/theme";
import { viewSearch, type AppView } from "@/lib/views";

const VIEWS: { value: AppView; label: string }[] = [
  { value: "planner", label: "Planner" },
  { value: "map", label: "Map" },
];

function ThemeToggle() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      aria-pressed={theme === "dark"}
      title={`Switch to ${next} theme`}
      className="flex h-5 items-center gap-1.5 border border-line px-2 text-[10px] font-medium uppercase leading-none tracking-[0.12em] text-muted hover:text-foreground"
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full border border-current"
        style={{ background: theme === "dark" ? "currentColor" : "transparent" }}
      />
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}

export function ViewToggle({ view }: { view: AppView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function select(next: AppView) {
    if (next === view) return;
    startTransition(() => {
      router.push(`/${viewSearch(window.location.search, next)}`);
    });
  }

  return (
    <nav
      aria-label="View"
      className={`relative flex h-7 shrink-0 items-center justify-center border-b border-line-soft bg-background ${
        pending ? "opacity-70" : ""
      }`}
    >
      <div className="flex h-5 border border-line">
        {VIEWS.map((v) => {
          const active = v.value === view;
          return (
            <button
              key={v.value}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => select(v.value)}
              className={`px-3 text-[10px] font-medium uppercase leading-none tracking-[0.12em] ${
                active ? "bg-foreground text-background" : "text-muted hover:text-foreground"
              }`}
            >
              {v.label}
            </button>
          );
        })}
      </div>
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
        <ThemeToggle />
      </div>
    </nav>
  );
}
