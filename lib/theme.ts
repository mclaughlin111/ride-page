"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_THEME, THEME_STORAGE_KEY, type Theme } from "./theme-config";

export { DEFAULT_THEME, type Theme };

const META_COLOR: Record<Theme, string> = { light: "#fafaf7", dark: "#17191b" };

export function parseTheme(value: unknown): Theme {
  return value === "dark" ? "dark" : "light";
}

const listeners = new Set<() => void>();

function read(): Theme {
  return parseTheme(document.documentElement.dataset.theme);
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLOR[theme]);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or storage disabled: the theme still applies for this page.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_THEME);
}
