import type { NextConfig } from "next";

// Keep in sync with the approved embed hosts in lib/route-embed.ts.
const frameSrc = [
  "https://ridewithgps.com",
  "https://www.ridewithgps.com",
  "https://www.strava.com",
  "https://strava-embeds.com",
  "https://www.komoot.com",
  "https://komoot.com",
  "https://connect.garmin.com",
  "https://www.google.com",
  "https://maps.google.com",
].join(" ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value: `frame-src ${frameSrc}; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`,
  },
];

// Served behind the reverse proxy at this path (see DEPLOYMENT.md). Set
// NEXT_PUBLIC_BASE_PATH= (empty) to run at the site root locally.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/ride";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
