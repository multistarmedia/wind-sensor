// Display formatting. Unavailable values render as an em dash, never as zero.

import {
  cDeltaToDisplay, cToDisplay, hpaToDisplay, mmToDisplay, msToDisplay, PRESSURE_DECIMALS, TEMP_LABEL, WIND_DECIMALS,
  type DisplayUnits,
} from '../../../shared/units';

export const DASH = '—';

export function fmt(v: number | null | undefined, decimals: number): string {
  return v == null || !Number.isFinite(v) ? DASH : v.toFixed(decimals);
}

export function windValue(ms: number | null | undefined, u: DisplayUnits) {
  return ms == null ? null : msToDisplay(ms, u.wind);
}
export const windText = (ms: number | null | undefined, u: DisplayUnits) => fmt(windValue(ms, u), WIND_DECIMALS[u.wind]);
export const tempText = (c: number | null | undefined, u: DisplayUnits) => fmt(c == null ? null : cToDisplay(c, u.temp), 1);
export const tempDeltaText = (c: number | null | undefined, u: DisplayUnits) => fmt(c == null ? null : cDeltaToDisplay(c, u.temp), 1);
export const pressureText = (h: number | null | undefined, u: DisplayUnits) => fmt(h == null ? null : hpaToDisplay(h, u.pressure), PRESSURE_DECIMALS[u.pressure]);
export const rainText = (mm: number | null | undefined, u: DisplayUnits) => fmt(mm == null ? null : mmToDisplay(mm, u.rain), u.rain === 'in' ? 2 : 1);

export const windUnitLabel = (u: DisplayUnits) => u.wind;
export const tempUnitLabel = (u: DisplayUnits) => TEMP_LABEL[u.temp];
export const pressureUnitLabel = (u: DisplayUnits) => u.pressure;

export function ageText(ms: number | null | undefined): string {
  if (ms == null) return DASH;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
