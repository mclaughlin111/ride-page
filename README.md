# Ride Board

Mobile-first group ride page built with Next.js (App Router), TypeScript and Tailwind CSS. Share the public URL in a group chat; the organiser manages rides from `/admin`.

- Public page `/` shows one ride at a time: date, start time, route (with an embedded preview where supported), meeting point (optional), comments, stops, completed status and Strava post.
- Signed-in admins see an **Edit** tag on each ride and a calendar button next to the date of upcoming rides that opens the editor on the date field. Visitors get a mini month calendar instead.
- Navigate rides by swiping, with the on-screen arrows, or with the left/right arrow keys. Deep link a ride with `/?ride=<ride-id>`.
- Admin `/admin` adds, edits, deletes, completes and reopens rides, and copies public links.
- A thin **Planner / Map** toggle at the top of `/` switches to a topographic map (`/?view=map`). The map is built for desktop; on phones it still works and shows a "best on desktop" notice.

## Terrain map

The map renders OS Terrain 50 elevation with Three.js / React Three Fiber in a dark wireframe style:

- Light / dark theme toggle (top bar, all pages). Saved in `localStorage` (default light) and applied before first paint. Each theme has its own 3D palette in `components/map/palette.ts`; switching keeps camera, area and routes.
- Relief shading: hillshade, slope and curvature computed from the real elevation grid, with a hypsometric colour ramp, under the wireframe and contours.
- Areas: **Bristol** (50 m grid, Avonmouth to Keynsham and south past Chew Valley Lake), **Avon** (100 m grid, about twice the Bristol extent each way: Severn Bridge to Wells and Clevedon to Bath, including the Mendips with Cheddar Gorge, Burrington Combe and Black Down) and **Region** (1 km grid, ~160 km around Bristol).
- Compass (top right) shows heading; click it to animate back to the default north-up view. **2D / 3D** sits beneath it and keeps the current area, routes and layers.
- Exaggeration slider (log scale) with 1×–20× stops for Bristol, up to 30× for Avon and up to 50× for the region. Terrain, roads, routes, labels and landmark models all use the same vertical scale.
- OpenStreetMap layers (Bristol and Avon areas): roads, paths/cycleways/bridleways, rail, water, parks/woods and built-up areas. Area fills are rasterised onto the terrain; lines are draped on it and fade out by zoom level.
- Illustrated low-poly landmark models (Clifton Suspension Bridge, Chew Valley Lake, Dundry, Park Street, Ashton Court, Harbourside and more) with three levels of detail: model, simplified model, icon, then hidden for minor landmarks.
- **Routes** dropdown: None, a single ride's route, or All routes. Geometry comes from `GET /api/routes`, which reads each ride's existing route link. Public Ride with GPS `/routes/<id>` and `/trips/<id>` links (with `privacy_code` if present) are fetched server-side from RWGPS's public JSON and cached for 6 hours. No API key is needed. Strava, Komoot, Garmin and RWGPS short `/s/` links are listed as unavailable: they need an authenticated API integration (OAuth) that is not built.

### Map data

Raw downloads are git-ignored and baked into small files that are committed:

```bash
npm run bake:terrain   # terr50_gagg_gb/ -> public/terrain/{bristol,avon,region}.bin, lib/terrain/manifest.json
npm run bake:osm       # osm/*.osm.pbf  -> public/terrain/osm-{bristol,avon}.bin, lib/terrain/osm.json
```

- **Terrain**: OS Terrain 50 ASCII grid (`terr50_gagg_gb/`, ~160 MB; needs the `unzip` CLI). Int16 decimetres, row 0 north, British National Grid (EPSG:27700). Contains OS data © Crown copyright and database right 2026, [OS OpenData licence](https://www.ordnancesurvey.co.uk/opendata/licence).
- **OpenStreetMap**: Geofabrik county extracts for Bristol, Somerset and Gloucestershire (~105 MB) in `osm/`; download commands are at the top of `scripts/bake-osm.mjs`. © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). Run `bake:terrain` first; re-run `bake:osm` whenever the Bristol or Avon extent changes (the `OVERLAYS` list in the script says which datasets get an overlay).

## Local development

```bash
npm install
cp .env.example .env.local   # then edit the values
npm run dev                  # http://localhost:3000/ride
```

Other scripts:

```bash
npm run lint
npm test
npm run build && npm start
```

The app is served under the base path `/ride` (`NEXT_PUBLIC_BASE_PATH`). To use the site root locally, run `NEXT_PUBLIC_BASE_PATH= npm run dev`. Docker and Nginx deployment is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Environment variables

| Name                    | Purpose                                                                                                   | Default               |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | --------------------- |
| `ADMIN_PASSWORD`        | Password for `/admin`. Server only, never sent to the browser.                                            | none (login disabled) |
| `SESSION_SECRET`        | Secret used to sign the session cookie. Use 16+ random characters, for example `openssl rand -base64 32`. | none (login disabled) |
| `DATA_FILE_PATH`        | Where rides are stored, relative to the working directory or absolute.                                    | `data/rides.json`     |
| `NEXT_PUBLIC_BASE_PATH` | URL path the app is served under. Fixed at build time.                                                    | `/ride`               |

If `ADMIN_PASSWORD` or `SESSION_SECRET` is missing (or the secret is shorter than 16 characters) the login page says admin is not configured.

## Admin login

1. Open `/admin`. Unauthenticated visitors are redirected to `/admin/login`.
2. Enter `ADMIN_PASSWORD`. The server sets a signed (HMAC-SHA256), `HttpOnly`, `SameSite=Lax` cookie valid for 12 hours. It is `Secure` when `NODE_ENV=production`.
3. Use **Log out** to clear it. If the session expires while editing, the admin page shows a "Session expired" notice with a link back to login.

All `POST`/`PUT`/`DELETE` API routes require a valid session and reject cross-origin requests. Failed logins are rate limited in memory (8 per 15 minutes per client).

Note: Safari does not accept `Secure` cookies on plain `http://localhost` with `next start`. Use `npm run dev` locally, or serve production over HTTPS.

## API

```
GET    /api/rides            public
GET    /api/routes           public (route geometry for the map)
POST   /api/rides            admin
PUT    /api/rides/[id]       admin
DELETE /api/rides/[id]       admin
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/session
```

Validation errors return `400` with `{ "errors": { "<field path>": "message" } }`, for example `route.url` or `stops.0.name`.

## JSON storage

Rides live in `data/rides.json` (or `DATA_FILE_PATH`).

- The directory and an empty `[]` file are created on first read.
- All data is validated on read and before every write, so a hand-edited bad file shows a "Could not load rides" state instead of crashing.
- Writes in a single server process are serialized and use write-to-temp-file then atomic rename.
- Multiple server processes sharing one file are not supported.
- Only `https://` URLs are stored. Map links must be Google Maps URLs (including `maps.app.goo.gl` short links). Strava post links must be on `strava.com`.

Rides are sorted upcoming first by date/time (in each ride's timezone, default `Europe/London`), then completed rides, most recent first. The Strava post link is stored with the ride but only shown on the public page while the ride is completed.

### Persistent volume requirements

This is a plain file on disk. It is **not durable on serverless or ephemeral hosting** (Vercel functions, most container platforms without volumes): the filesystem is read-only or wiped on deploy, restart or scale-out. Deploy to a host with a **persistent, writable volume** (a VPS, or a container with a mounted volume) and point `DATA_FILE_PATH` at it, for example `/data/rides.json`. Run a single instance.

### Backups

Copy the file while the app is running; writes are atomic so a copy is always a complete file:

```bash
cp data/rides.json "backups/rides-$(date +%F).json"
```

Restore by replacing the file (any time; it is re-read on every request). A cron job or host-level volume snapshot is recommended.

## Deployment assumptions

- Docker with a persistent volume behind Nginx at `https://tommcl.co.uk/ride` (see [DEPLOYMENT.md](DEPLOYMENT.md)), or any long-running Node.js server (`npm run build && npm start`) with a persistent writable volume.
- A single instance, served over HTTPS (needed for the `Secure` session cookie).
- `ADMIN_PASSWORD` and `SESSION_SECRET` set in the server environment.
- Security headers are set in `next.config.ts`, including a `frame-src` allow-list for route embeds.

## Route links and embeds

The route form takes a normal share link and auto-detects the provider from the hostname (Ride with GPS, Strava, Garmin, Komoot, otherwise Other). The public page always shows the provider name and an **Open route** link. A preview iframe is added only when it can be built safely; otherwise a plain link card is shown. A failing or slow embed never affects the rest of the page.

| Provider      | Preview from a normal share link                                                                                                                                               | With an official embed URL                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Ride with GPS | Yes, for `/routes/<id>` and `/trips/<id>` links (a `privacy_code` is passed through). Short `/s/...` links cannot be expanded without scraping, so they fall back to the link. | Yes                                                                          |
| Komoot        | Yes, for `/tour/<id>` links. Works for public tours or links with a `share_token`.                                                                                             | Yes                                                                          |
| Strava        | No. Strava embeds need a token generated by Strava.                                                                                                                            | Yes, `strava.com/(activities\|routes)/<id>/embed/<token>` for public content |
| Garmin        | No. Treated as a normal link.                                                                                                                                                  | Yes, only from `connect.garmin.com`                                          |
| Other         | No                                                                                                                                                                             | No                                                                           |

Embed formats are provider-controlled and may change. If one stops working, the Open route link still works, and you can paste a new official embed URL.

### Adding an official route embed URL

1. In the provider's share or embed dialog, copy the generated iframe HTML.
2. Copy the `src` value (the `https://...` URL) from that HTML, or the whole iframe.
3. Paste it into **Embed URL (optional)** in the ride form. Pasting the whole iframe code also works: only the `src` is extracted and checked.

The server rejects `http://` URLs, HTML without a usable `src`, and any domain that is not an approved provider domain. Approved embed hosts: `ridewithgps.com`, `www.strava.com`, `strava-embeds.com`, `www.komoot.com`, `connect.garmin.com`, plus `google.com/maps/embed` for the meeting point. To add a provider, add an adapter in `lib/route-embed.ts` and its origin to `frame-src` in `next.config.ts`.

Strava and Komoot previews only work for publicly viewable content. Embeds render in sandboxed iframes; no provider HTML is ever rendered and no provider API keys are used.

## Meeting point, maps and images

- The meeting point is optional. If you fill any meeting field, the location name is required.
- A Google Maps picker widget needs a Maps API key, which this version avoids. Instead, in Google Maps choose **Share > Embed a map** and paste the iframe code (or just its `src`) into **Map embed**. Only `google.com/maps/embed...` URLs are accepted, and only the `src` is kept.
- **Preview images:** when a ride is saved, the server looks up the Open Graph image of each stop's Maps link and, for completed rides, of the Strava post link, and stores the image URL in `rides.json`. Only `strava.com`, `maps.app.goo.gl`, `goo.gl` and `google.com` pages are fetched (https only, redirects re-checked, 5 s timeout, 1 MB cap), and only images from known hosts are kept. Google pages only offer a plain static map, not a photo of the place. Strava gives the route map image. If a lookup fails the ride still saves, and a re-save retries it. Image URLs cannot be set by API clients.
- **Strava embed:** on the Strava activity choose **Share > Embed on Your Site** and paste the snippet into **Strava embed** (shown for completed rides). Only the activity id, type and token are kept. The page builds the same iframe as Strava's `embed.js` without loading that script, and resizes it from the frame's height messages. It replaces the preview image when present.

## Tests

`npm test` runs Vitest covering ride sorting, carousel navigation (buttons, keyboard, swipe), provider detection, URL and Google Maps validation, JSON storage, admin authentication and API access, completed rides and Strava link handling.
