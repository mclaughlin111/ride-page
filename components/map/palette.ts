import type { Theme } from "@/lib/theme-config";
import type { OsmClass } from "@/lib/terrain/osm";

export type LineStyle = {
  color: string;
  /** CSS pixels at the reference zoom. */
  width: number;
  alpha: number;
  /** Camera distance (scene units) where the class has fully faded out. */
  fade: number;
};

export type FillStyle = { color: string; alpha: number };

export type FillClass =
  | "water"
  | "park"
  | "wood"
  | "open"
  | "residential"
  | "commercial"
  | "industrial";

/**
 * Material palette for the 3D map. Each theme is designed separately (light
 * is not an inversion of dark) so both read as a relief map.
 */
export type MapPalette = {
  background: string;
  /** Hypsometric ramp, lowest to highest elevation. */
  hypso: [string, string, string, string, string];
  /** Colour blended in on steep slopes (exposed rock / scarp). */
  slope: string;
  /** Hillshade tints multiplied into the surface: shaded side, lit side. */
  shadow: string;
  highlight: string;
  /** How strongly hillshade modulates the surface (0-1). */
  relief: number;
  sea: string;
  wireLow: string;
  wireHigh: string;
  wireAlpha: number;
  contourMinor: string;
  contourMajor: string;
  contourAlpha: number;
  accent: string;
  /** Kept low-alpha so surroundings never compete with routes. */
  fills: Record<FillClass, FillStyle>;
  lines: Partial<Record<OsmClass, LineStyle>>;
  routeColors: string[];
  routeCasing: { color: string; alpha: number };
  models: {
    stone: string;
    dark: string;
    roof: string;
    land: string;
    water: string;
    accent: string;
    icon: string;
    cable: string;
    sky: string;
    ground: string;
    lightIntensity: number;
  };
};

const DARK: MapPalette = {
  background: "#15171a",
  hypso: ["#262b2e", "#2e3632", "#3a4439", "#535849", "#8a887b"],
  slope: "#5f5a52",
  shadow: "#3a3f55",
  highlight: "#f2eadb",
  relief: 1,
  sea: "#1b2329",
  wireLow: "#7d8287",
  wireHigh: "#dfe2e4",
  wireAlpha: 0.32,
  contourMinor: "#8d9189",
  contourMajor: "#d8dad2",
  contourAlpha: 0.4,
  accent: "#6fdde2",
  fills: {
    water: { color: "#4a7186", alpha: 0.92 },
    park: { color: "#5a7a5f", alpha: 0.4 },
    wood: { color: "#47634c", alpha: 0.5 },
    open: { color: "#6b7558", alpha: 0.16 },
    residential: { color: "#a7a49c", alpha: 0.14 },
    commercial: { color: "#b49a86", alpha: 0.2 },
    industrial: { color: "#8f95a0", alpha: 0.22 },
  },
  lines: {
    stream: { color: "#6f9fb2", width: 0.8, alpha: 0.75, fade: 6 },
    river: { color: "#86b9cd", width: 1.7, alpha: 0.95, fade: 40 },
    footpath: { color: "#aea694", width: 0.7, alpha: 0.7, fade: 3.5 },
    bridleway: { color: "#c0a47a", width: 0.8, alpha: 0.75, fade: 4.5 },
    cycleway: { color: "#9fd6b9", width: 1.3, alpha: 0.9, fade: 10 },
    road_minor: { color: "#8f8d86", width: 0.8, alpha: 0.6, fade: 5 },
    road_secondary: { color: "#bdbab1", width: 1.3, alpha: 0.75, fade: 14 },
    road_major: { color: "#e6e2d8", width: 2.1, alpha: 0.9, fade: 40 },
    rail: { color: "#bdb7cf", width: 1.2, alpha: 0.85, fade: 30 },
    bridge: { color: "#ffffff", width: 2.8, alpha: 1, fade: 14 },
  },
  routeColors: ["#6fdde2", "#f0bf63", "#e597b4", "#b3dc84", "#a6b2ff", "#f39c77"],
  routeCasing: { color: "#07080a", alpha: 0.7 },
  models: {
    stone: "#c4c6c8",
    dark: "#62676c",
    roof: "#8c9095",
    land: "#6f7b70",
    water: "#5f8698",
    accent: "#6fdde2",
    icon: "#eceef0",
    cable: "#dadde0",
    sky: "#dfe3e8",
    ground: "#202326",
    lightIntensity: 1.6,
  },
};

const LIGHT: MapPalette = {
  background: "#ece8df",
  hypso: ["#d9cfae", "#cdcca6", "#b3b892", "#a3a387", "#e7e2d6"],
  slope: "#b8ab95",
  shadow: "#6a6688",
  highlight: "#fff9ec",
  relief: 0.9,
  sea: "#c9d6da",
  wireLow: "#5d5b54",
  wireHigh: "#7a776d",
  wireAlpha: 0.32,
  contourMinor: "#7d7766",
  contourMajor: "#4f4a3e",
  contourAlpha: 0.6,
  accent: "#23838a",
  fills: {
    water: { color: "#8fb8c8", alpha: 0.95 },
    park: { color: "#a4b98a", alpha: 0.45 },
    wood: { color: "#879f73", alpha: 0.55 },
    open: { color: "#c3c29a", alpha: 0.22 },
    residential: { color: "#bcb3a4", alpha: 0.3 },
    commercial: { color: "#c9a99a", alpha: 0.3 },
    industrial: { color: "#a9a9b0", alpha: 0.32 },
  },
  lines: {
    stream: { color: "#5f97ad", width: 0.8, alpha: 0.75, fade: 6 },
    river: { color: "#447f98", width: 1.8, alpha: 0.95, fade: 40 },
    footpath: { color: "#8a7c66", width: 0.7, alpha: 0.75, fade: 3.5 },
    bridleway: { color: "#9a7547", width: 0.8, alpha: 0.8, fade: 4.5 },
    cycleway: { color: "#2f8562", width: 1.4, alpha: 0.9, fade: 10 },
    road_minor: { color: "#8e897d", width: 1, alpha: 0.8, fade: 6 },
    road_secondary: { color: "#67625a", width: 1.6, alpha: 0.9, fade: 18 },
    road_major: { color: "#3e3b35", width: 2.4, alpha: 0.95, fade: 40 },
    rail: { color: "#5a5668", width: 1.2, alpha: 0.85, fade: 30 },
    bridge: { color: "#1f1d1a", width: 2.8, alpha: 1, fade: 14 },
  },
  routeColors: ["#1b7f88", "#b06f12", "#b04a76", "#4f7f24", "#4c56c0", "#c0562a"],
  routeCasing: { color: "#fbfaf6", alpha: 0.85 },
  models: {
    stone: "#f2eee4",
    dark: "#8a8578",
    roof: "#b6a68f",
    land: "#a3b18a",
    water: "#8fb6c6",
    accent: "#23838a",
    icon: "#34332f",
    cable: "#4a4844",
    sky: "#fffaf0",
    ground: "#8f8a7c",
    lightIntensity: 1.9,
  },
};

export const PALETTES: Record<Theme, MapPalette> = { dark: DARK, light: LIGHT };
