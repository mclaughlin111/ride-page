// Shared by the server layout (init script) and the client theme store.
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
export const DEFAULT_THEME: Theme = "light";

/**
 * Runs before first paint (inlined in the root layout) so a saved dark theme
 * never flashes light. Keep in sync with THEME_STORAGE_KEY / DEFAULT_THEME.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="dark"&&t!=="light")t="${DEFAULT_THEME}";document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="${DEFAULT_THEME}";}})();`;
