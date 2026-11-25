import { useSyncExternalStore } from "react";
import type { TerrainPick } from "@/lib/terrain/picking";

/**
 * Tiny external store for values that change every frame (hover pick,
 * camera heading) so the overlay can show them without re-rendering the
 * WebGL tree.
 */
function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const hoverStore = createStore<TerrainPick | null>(null);
/** Camera heading in radians, 0 = looking north. */
export const headingStore = createStore(0);

export function useStore<T>(store: ReturnType<typeof createStore<T>>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * Landmark label elements rendered by the overlay, keyed by name. The scene
 * positions them each frame by writing transforms directly.
 */
export const labelElements = new Map<string, HTMLElement>();
