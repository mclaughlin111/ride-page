/**
 * Path the app is served under behind the reverse proxy (e.g. "/ride"), set by
 * NEXT_PUBLIC_BASE_PATH and matched by `basePath` in next.config.ts. Next's
 * <Link> and router add it automatically; plain fetch() calls, anchors and
 * history updates need it added by hand.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

/** The app's home path without a trailing slash ("/ride", or "/" with no base path). */
export const ROOT_PATH = BASE_PATH || "/";
