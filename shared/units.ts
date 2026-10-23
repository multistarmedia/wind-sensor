// Unit conversion. Storage is canonical (m/s, °C, hPa, mm); display units never touch storage.

import type { PressureInputUnit, RainInputUnit, TempInputUnit, WindInputUnit } from './profile';

export const MPH_TO_MS = 0.44704;
export const KMH_TO_MS = 1 / 3.6;
export const KNOT_TO_MS = 1852 / 3600;
export const INHG_TO_HPA = 33.86389;
export const MMHG_TO_HPA = 1.333224;
export const IN_TO_MM = 25.4;

export function windToMs(v: number, unit: WindInputUnit): number {
  return unit === 'mph' ? v * MPH_TO_MS : v;
}
export function tempToC(v: number, unit: TempInputUnit): number {
  return unit === 'F' ? ((v - 32) * 5) / 9 : v;
}
export function pressureToHpa(v: number, unit: PressureInputUnit): number {
  if (unit === 'inHg') return v * INHG_TO_HPA;
  if (unit === 'mmHg') return v * MMHG_TO_HPA;
  return v;
}
export function rainToMm(v: number, unit: RainInputUnit): number {
  return unit === 'in' ? v * IN_TO_MM : v;
}

export const WIND_DISPLAY_UNITS = ['mph', 'm/s', 'km/h', 'kn'] as const;
export const TEMP_DISPLAY_UNITS = ['F', 'C'] as const;
export const PRESSURE_DISPLAY_UNITS = ['inHg', 'hPa', 'mmHg'] as const;
export const RAIN_DISPLAY_UNITS = ['in', 'mm'] as const;

export interface DisplayUnits {
  wind: (typeof WIND_DISPLAY_UNITS)[number];
  temp: (typeof TEMP_DISPLAY_UNITS)[number];
  pressure: (typeof PRESSURE_DISPLAY_UNITS)[number];
  rain: (typeof RAIN_DISPLAY_UNITS)[number];
}

export const DEFAULT_DISPLAY_UNITS: DisplayUnits = { wind: 'mph', temp: 'F', pressure: 'inHg', rain: 'in' };

export function validateDisplayUnits(o: unknown): DisplayUnits | null {
  const d = (o ?? {}) as Record<string, unknown>;
  const ok =
    WIND_DISPLAY_UNITS.includes(d.wind as never) &&
    TEMP_DISPLAY_UNITS.includes(d.temp as never) &&
    PRESSURE_DISPLAY_UNITS.includes(d.pressure as never) &&
    RAIN_DISPLAY_UNITS.includes(d.rain as never);
  return ok ? { wind: d.wind, temp: d.temp, pressure: d.pressure, rain: d.rain } as DisplayUnits : null;
}

export function msToDisplay(v: number, unit: DisplayUnits['wind']): number {
  switch (unit) {
    case 'mph': return v / MPH_TO_MS;
    case 'km/h': return v / KMH_TO_MS;
    case 'kn': return v / KNOT_TO_MS;
    default: return v;
  }
}
export function cToDisplay(v: number, unit: DisplayUnits['temp']): number {
  return unit === 'F' ? (v * 9) / 5 + 32 : v;
}
/** For temperature differences (no offset). */
export function cDeltaToDisplay(v: number, unit: DisplayUnits['temp']): number {
  return unit === 'F' ? (v * 9) / 5 : v;
}
export function hpaToDisplay(v: number, unit: DisplayUnits['pressure']): number {
  if (unit === 'inHg') return v / INHG_TO_HPA;
  if (unit === 'mmHg') return v / MMHG_TO_HPA;
  return v;
}
export function mmToDisplay(v: number, unit: DisplayUnits['rain']): number {
  return unit === 'in' ? v / IN_TO_MM : v;
}

export const WIND_DECIMALS: Record<DisplayUnits['wind'], number> = { mph: 1, 'm/s': 1, 'km/h': 0, kn: 1 };
export const PRESSURE_DECIMALS: Record<DisplayUnits['pressure'], number> = { inHg: 2, hPa: 1, mmHg: 1 };
export const TEMP_LABEL: Record<DisplayUnits['temp'], string> = { F: '°F', C: '°C' };
