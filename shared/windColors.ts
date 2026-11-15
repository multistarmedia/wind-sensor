// Wind colour scale. Speed → colour is continuous and independent of Beaufort;
// Beaufort remains only for the dial’s force name. Speeds above maxSpeedMs reuse the top colour.

import { BEAUFORT_EDGES_MS, beaufortForce, CALM_THRESHOLD_MS } from './wind';
import type { DisplayUnits } from './units';
import { msToDisplay, MPH_TO_MS, KMH_TO_MS, KNOT_TO_MS } from './units';

export const WIND_BAND_COUNT = 12;

/** Classic blue→magenta ramp (12 stops). */
export const PALETTE_CLASSIC = [
  '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#eab308',
  '#f59e0b', '#f97316', '#ef4444', '#dc2626', '#db2777', '#a21caf',
] as const;

export const PALETTE_COOL = [
  '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7',
  '#0369a1', '#075985', '#0c4a6e', '#164e63', '#1e3a5f', '#172554',
] as const;

export const PALETTE_WARM = [
  '#fef9c3', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#f97316',
  '#ea580c', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d', '#450a0a',
] as const;

export const WIND_COLOR_PALETTES = {
  classic: PALETTE_CLASSIC,
  cool: PALETTE_COOL,
  warm: PALETTE_WARM,
} as const;

export type WindPaletteId = keyof typeof WIND_COLOR_PALETTES;

export const WIND_PALETTE_OPTIONS: { id: WindPaletteId; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'cool', label: 'Cool' },
  { id: 'warm', label: 'Warm' },
];

export const CALM_COLOR = '#94a3b8';

/** Default max = top Beaufort edge (~73 mph). */
export const DEFAULT_MAX_SPEED_MS = BEAUFORT_EDGES_MS[BEAUFORT_EDGES_MS.length - 1]!;

/** Slider range in display units: wide enough for local breezes through storm. */
export function maxSpeedSliderBounds(unit: DisplayUnits['wind']): { min: number; max: number; step: number } {
  switch (unit) {
    case 'mph': return { min: 4, max: 120, step: 1 };
    case 'km/h': return { min: 5, max: 200, step: 1 };
    case 'kn': return { min: 3, max: 100, step: 1 };
    default: return { min: 2, max: 55, step: 0.5 }; // m/s
  }
}

export function displayToMs(v: number, unit: DisplayUnits['wind']): number {
  switch (unit) {
    case 'mph': return v * MPH_TO_MS;
    case 'km/h': return v * KMH_TO_MS;
    case 'kn': return v * KNOT_TO_MS;
    default: return v;
  }
}

export function clampMaxSpeedMs(ms: number): number {
  // Absolute floor just above calm; ceiling ~ hurricane+ in m/s.
  if (!Number.isFinite(ms)) return DEFAULT_MAX_SPEED_MS;
  return Math.min(60, Math.max(CALM_THRESHOLD_MS + 0.2, ms));
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = h.length === 3
    ? [h[0]! + h[0]!, h[1]! + h[1]!, h[2]! + h[2]!]
    : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return [parseInt(n[0]!, 16), parseInt(n[1]!, 16), parseInt(n[2]!, 16)];
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Interpolate across palette stops; t in [0, 1]. */
export function paletteColorAt(t: number, palette: readonly string[]): string {
  if (palette.length === 0) return CALM_COLOR;
  if (palette.length === 1) return palette[0]!;
  const x = Math.min(1, Math.max(0, t)) * (palette.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  if (f < 1e-9 || i >= palette.length - 1) return palette[Math.min(i, palette.length - 1)]!;
  const [r0, g0, b0] = parseHex(palette[i]!);
  const [r1, g1, b1] = parseHex(palette[i + 1]!);
  return toHex(r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f);
}

/** Position of speed on the scale: 0 at calm threshold, 1 at maxSpeedMs (clamped). */
export function speedScaleT(speedMs: number, maxSpeedMs: number): number {
  const max = clampMaxSpeedMs(maxSpeedMs);
  const lo = CALM_THRESHOLD_MS;
  if (speedMs <= lo) return 0;
  return Math.min(1, (speedMs - lo) / (max - lo));
}

/** Colour for a wind speed; above maxSpeedMs repeats the top stop. */
export function windSpeedColor(speedMs: number, palette: readonly string[], maxSpeedMs: number): string {
  if (speedMs < CALM_THRESHOLD_MS || beaufortForce(speedMs) === 0) return CALM_COLOR;
  return paletteColorAt(speedScaleT(speedMs, maxSpeedMs), palette);
}

/**
 * Colour for a rose force bin index 0–11 (Beaufort 1–12 storage).
 * Uses the band’s lower edge speed so the rose matches the continuous dial scale.
 */
export function bandColor(forceIndex0: number, palette: readonly string[], maxSpeedMs: number): string {
  const i = Math.max(0, Math.min(WIND_BAND_COUNT - 1, forceIndex0));
  return windSpeedColor(BEAUFORT_EDGES_MS[i]!, palette, maxSpeedMs);
}

/** CSS linear-gradient for the scale track / legend. */
export function paletteGradientCss(palette: readonly string[]): string {
  if (palette.length === 0) return CALM_COLOR;
  if (palette.length === 1) return palette[0]!;
  const stops = palette.map((c, i) => `${c} ${(i / (palette.length - 1)) * 100}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** Tick labels along 0…max for the legend (display units). */
export function scaleTickLabels(maxSpeedMs: number, unit: DisplayUnits['wind'], count = 5): { t: number; label: string }[] {
  const max = clampMaxSpeedMs(maxSpeedMs);
  const n = Math.max(2, count);
  const out: { t: number; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const ms = CALM_THRESHOLD_MS + t * (max - CALM_THRESHOLD_MS);
    const v = msToDisplay(ms, unit);
    const label = i === n - 1
      ? `${v.toFixed(v >= 10 ? 0 : 1)}+`
      : v.toFixed(v >= 10 ? 0 : 1);
    out.push({ t, label });
  }
  return out;
}

/** @deprecated Prefer windSpeedColor with maxSpeedMs. */
export function clampBand(force: number, maxBand: number): number {
  const max = Math.max(1, Math.min(WIND_BAND_COUNT, Math.round(maxBand)));
  if (force <= 0) return 0;
  return Math.min(force, max);
}
