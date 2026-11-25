export type AppView = "planner" | "map";

export function parseView(value: string | string[] | undefined): AppView {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "map" ? "map" : "planner";
}

/**
 * Query string for switching view, keeping other params (e.g. the selected
 * ride) so returning to the planner lands on the same ride.
 */
export function viewSearch(currentSearch: string, view: AppView): string {
  const params = new URLSearchParams(currentSearch);
  if (view === "map") params.set("view", "map");
  else params.delete("view");
  const query = params.toString();
  return query ? `?${query}` : "";
}
