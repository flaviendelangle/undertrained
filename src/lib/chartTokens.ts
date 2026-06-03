import { useMemo } from "react";

import { useTheme } from "~/hooks/useTheme";
import { getSportConfig } from "~/utils/sportConfig";
import type { SportCategory } from "~/utils/sportConfig";

// ---------------------------------------------------------------------------
// Chart color contract
// ---------------------------------------------------------------------------
//
// Charts in this app draw from three deliberately separate color systems. Pick
// the one whose *meaning* matches the data — don't mix them within a chart:
//
//   • sport colors (`tokens.sport`, via `sportColor()`) — encode "which sport".
//     Use for any series/bar/segment/route whose identity IS a sport, so the
//     same sport reads identically in the Journal, the Statistics timeline, and
//     the Map. Source of truth: the `--sport-*` OKLCH in globals.css.
//
//   • zone ramp (`tokens.zones`) — a cool→hot ramp encoding ordinal intensity
//     (power/HR/pace zones, lap bars, zone histograms). Resolve by the zone's
//     `ramp` index; never hardcode a zone hex.
//
//   • categorical palette (`tokens.palette`) — arbitrary distinct series with no
//     sport or intensity meaning (CTL/ATL/TSB, stream panels, power-curve
//     ranges, year-over-year lines), used in index order.
//
// `tokens.accent` (brand teal) is reserved for highlight/selection states
// (the Eddington-number bar, the map "you are here" marker) — it is a chrome
// accent, not a data color, so it must not clash with a series meaning.

// ---------------------------------------------------------------------------
// OKLCH → sRGB conversion (moved from webgl/colors.ts to centralise)
// ---------------------------------------------------------------------------

function linearToSrgb(x: number): number {
  const clamped = Math.max(0, Math.min(1, x));
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

/**
 * Convert an oklch(L C H) CSS color string to [r, g, b] in sRGB [0..1].
 *
 * Pipeline: oklch → oklab → linear sRGB (via LMS cube roots) → sRGB gamma
 */
export function oklchToRgb(oklchStr: string): [number, number, number] {
  const match = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(oklchStr);
  if (!match) {
    throw new Error(`Cannot parse oklch color: ${oklchStr}`);
  }

  const L = parseFloat(match[1]);
  const C = parseFloat(match[2]);
  const H = parseFloat(match[3]);

  // oklch → oklab
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // oklab → LMS (cube roots)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  // Cube to get LMS
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // LMS → linear sRGB
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  // linear sRGB → sRGB gamma
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

/** Convert an oklch CSS string to a hex color string. */
export function oklchToHex(oklchStr: string): string {
  const [r, g, b] = oklchToRgb(oklchStr);
  const toHex = (c: number) =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ---------------------------------------------------------------------------
// Hex → GL conversion
// ---------------------------------------------------------------------------

function hexToGL(hex: string, alpha = 1.0): Float32Array {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Float32Array([r, g, b, alpha]);
}

// ---------------------------------------------------------------------------
// Chart tokens
// ---------------------------------------------------------------------------

export interface ChartTokens {
  /** 8 hex colors for chart series (x-charts) */
  palette: string[];
  /** 8 OKLCH strings for chart series (WebGL / SVG) */
  paletteOklch: string[];
  /** Cool→hot intensity ramp (7 stops) for power/HR/pace zones — index by `ramp`. */
  zones: string[];
  /** Resolved sport-category colors (hex), theme-aware. Prefer {@link sportColor}. */
  sport: Record<SportCategory, string>;
  /** Brand highlight/selection accent (primary teal), hex. */
  accent: string;
  /** Grid line color */
  grid: { hex: string; gl: Float32Array };
  /** Separator / axis line color */
  gridStrong: { hex: string; gl: Float32Array };
  /** Axis tick label color (hex) */
  axisLabel: string;
  /** Crosshair line color (hex) */
  crosshair: string;
  /** Card background hex (for crosshair dot stroke) */
  cardBg: string;
}

// ---------------------------------------------------------------------------
// Theme definitions — keep in sync with globals.css
// ---------------------------------------------------------------------------

interface ThemeDefinition {
  paletteOklch: string[];
  /** 7-stop cool→hot zone ramp (recovery → neuromuscular). */
  zonesOklch: string[];
  /** Sport-category colors, mirroring the `--sport-*` vars in globals.css. */
  sportOklch: Record<SportCategory, string>;
  /** Brand accent (primary teal), mirroring `--primary`. */
  accentOklch: string;
  grid: string;
  gridStrong: string;
  axisLabel: string;
  crosshair: string;
  cardBg: string;
}

const LIGHT_THEME: ThemeDefinition = {
  paletteOklch: [
    "oklch(0.59 0.20 25.331)",
    "oklch(0.52 0.17 280)",
    "oklch(0.58 0.20 354.308)",
    "oklch(0.58 0.16 254.624)",
    "oklch(0.56 0.14 145)",
    "oklch(0.60 0.19 41.116)",
    "oklch(0.55 0.11 184.704)",
    "oklch(0.60 0.14 84.429)",
  ],
  // Recovery·gray → endurance·blue → tempo·green → threshold·gold →
  // vo2·orange → anaerobic·red → neuro·dark-red. Theme-aware so the cool end
  // stays legible on a light card.
  zonesOklch: [
    "oklch(0.62 0.01 260)",
    "oklch(0.60 0.16 256)",
    "oklch(0.60 0.15 150)",
    "oklch(0.72 0.15 85)",
    "oklch(0.66 0.18 45)",
    "oklch(0.60 0.20 25)",
    "oklch(0.52 0.20 27)",
  ],
  sportOklch: {
    cycling: "oklch(0.58 0.20 354.308)",
    running: "oklch(0.55 0.11 184.704)",
    swimming: "oklch(0.58 0.16 254.624)",
    strength: "oklch(0.60 0.19 41.116)",
    hiking: "oklch(0.55 0.13 130)",
    other: "oklch(0.52 0.17 280)",
  },
  accentOklch: "oklch(0.45 0.15 170)",
  grid: "#e2e3e8",
  gridStrong: "#c4c5ce",
  axisLabel: "#81828f",
  crosshair: "#81828f",
  cardBg: "#ffffff",
};

const DARK_THEME: ThemeDefinition = {
  paletteOklch: [
    "oklch(0.73 0.22 25.331)",
    "oklch(0.68 0.18 280)",
    "oklch(0.72 0.22 354.308)",
    "oklch(0.74 0.17 254.624)",
    "oklch(0.73 0.16 145)",
    "oklch(0.74 0.21 41.116)",
    "oklch(0.70 0.12 184.704)",
    "oklch(0.78 0.18 84.429)",
  ],
  // Same ramp, lightness lifted (like the palette) so gold/red read on a dark
  // card — the legibility fix the raw Tailwind hex lacked.
  zonesOklch: [
    "oklch(0.70 0.01 260)",
    "oklch(0.70 0.16 256)",
    "oklch(0.72 0.15 150)",
    "oklch(0.82 0.15 85)",
    "oklch(0.74 0.18 45)",
    "oklch(0.70 0.20 25)",
    "oklch(0.62 0.21 27)",
  ],
  sportOklch: {
    cycling: "oklch(0.72 0.22 354.308)",
    running: "oklch(0.70 0.12 184.704)",
    swimming: "oklch(0.74 0.17 254.624)",
    strength: "oklch(0.74 0.21 41.116)",
    hiking: "oklch(0.72 0.16 130)",
    other: "oklch(0.68 0.18 280)",
  },
  accentOklch: "oklch(0.65 0.15 170)",
  grid: "#656572",
  gridStrong: "#81828f",
  axisLabel: "#b5b6bf",
  crosshair: "#a5a6b1",
  cardBg: "#56575f",
};

function buildTokens(theme: ThemeDefinition): ChartTokens {
  const palette = theme.paletteOklch.map(oklchToHex);
  const sportEntries = Object.entries(theme.sportOklch) as [
    SportCategory,
    string,
  ][];

  return {
    palette,
    paletteOklch: theme.paletteOklch,
    zones: theme.zonesOklch.map(oklchToHex),
    sport: Object.fromEntries(
      sportEntries.map(([category, c]) => [category, oklchToHex(c)]),
    ) as Record<SportCategory, string>,
    accent: oklchToHex(theme.accentOklch),
    grid: { hex: theme.grid, gl: hexToGL(theme.grid) },
    gridStrong: { hex: theme.gridStrong, gl: hexToGL(theme.gridStrong) },
    axisLabel: theme.axisLabel,
    crosshair: theme.crosshair,
    cardBg: theme.cardBg,
  };
}

// Pre-compute tokens for each theme to avoid recomputing on every render
const TOKENS_LIGHT = buildTokens(LIGHT_THEME);
const TOKENS_DARK = buildTokens(DARK_THEME);

/**
 * React hook that returns chart design tokens.
 * Resolves synchronously based on the current theme — no CSS variable reading.
 */
export function useChartTokens(): ChartTokens {
  const { resolvedTheme } = useTheme();
  return useMemo(
    () => (resolvedTheme === "dark" ? TOKENS_DARK : TOKENS_LIGHT),
    [resolvedTheme],
  );
}

/**
 * Theme-aware color for a Strava activity type, resolved through its sport
 * category. Use anywhere a series/bar/route's identity *is* a sport so it
 * matches the Journal chips and the Map.
 */
export function sportColor(tokens: ChartTokens, activityType: string): string {
  return tokens.sport[getSportConfig(activityType).category];
}

// ---------------------------------------------------------------------------
// Compact number formatting for mobile y-axis labels
// ---------------------------------------------------------------------------

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const v = value / 1_000_000;
    return `${Number.isInteger(v) ? v : +v.toPrecision(2)}M`;
  }
  if (abs >= 1_000) {
    const v = value / 1_000;
    return `${Number.isInteger(v) ? v : +v.toPrecision(2)}k`;
  }
  return String(Math.round(value));
}

// ---------------------------------------------------------------------------
// Standard margin presets
// ---------------------------------------------------------------------------

/**
 * Axis sizes — override MUI defaults (45px width, 25px height).
 * These are additive with the margin, so keep margin small.
 */
export const AXIS_SIZE = {
  desktop: { width: 60, height: 25 },
  mobile: { width: 32, height: 20 },
} as const;

/**
 * Font sizes for the custom SVG/WebGL charts (PowerCurve, ActivityStreams),
 * which render their own axes and labels. MUI x-charts get their tick/label
 * sizing from the global `.MuiChartsAxis-*` rules in globals.css — do not set
 * per-chart tick styles on those.
 */
export const CHART_FONT = {
  /** Axis tick labels (matches the 11px MUI global rule). */
  tick: 11,
  /** Axis titles. */
  axisLabel: 11,
  /** Secondary per-panel stats (e.g. min/max gutter labels). */
  panelStat: 10,
  /** Hover/live-value readouts. */
  readout: 12,
} as const;

/** Dashed annotation line marking a target/threshold (e.g. peak fitness, avg). */
export const REFERENCE_LINE = { dash: "4 4", opacity: 0.6 } as const;

export const CHART_MARGINS = {
  /** Standard single-panel chart with y-axis on left */
  standard: { left: 8, right: 16, top: 16, bottom: 8 },
  /** Standard margins for mobile */
  standardMobile: { left: 4, right: 4, top: 4, bottom: 4 },
  /** Compact margin for dense multi-panel layouts */
  compact: { top: 8, right: 16, bottom: 36, left: 56 },
  /** Dual-axis chart with labels on both sides */
  dualAxis: { left: 40, right: 40, top: 20, bottom: 24 },
} as const;
