// Temperature display helpers. Dew point and feels-like are calculated from measured fields only.

/** Approximate dew point (°C) from air temperature (°C) and relative humidity (%). Magnus-Tetens. */
export function dewPointC(airTempC: number, rhPct: number): number | null {
  if (!Number.isFinite(airTempC) || !Number.isFinite(rhPct) || rhPct <= 0) return null;
  const rh = Math.min(100, Math.max(0.1, rhPct));
  const a = 17.27;
  const b = 237.7;
  const alpha = Math.log(rh / 100) + (a * airTempC) / (b + airTempC);
  const td = (b * alpha) / (a - alpha);
  return Number.isFinite(td) ? td : null;
}

/**
 * Apparent temperature (°C): wind chill when cold and breezy, heat index when hot and humid,
 * otherwise air temperature. Inputs are measured station values.
 */
export function feelsLikeC(airTempC: number, rhPct: number, windSpeedMs: number): number | null {
  if (!Number.isFinite(airTempC)) return null;
  const tF = (airTempC * 9) / 5 + 32;
  const vMph = Math.max(0, windSpeedMs) / 0.44704;
  const rh = Number.isFinite(rhPct) ? Math.min(100, Math.max(0, rhPct)) : 50;

  if (tF <= 50 && vMph >= 3) {
    const wc =
      35.74 +
      0.6215 * tF -
      35.75 * Math.pow(vMph, 0.16) +
      0.4275 * tF * Math.pow(vMph, 0.16);
    return ((wc - 32) * 5) / 9;
  }

  if (tF >= 80) {
    const hi =
      -42.379 +
      2.04901523 * tF +
      10.14333127 * rh -
      0.22475541 * tF * rh -
      0.00683783 * tF * tF -
      0.05481717 * rh * rh +
      0.00122874 * tF * tF * rh +
      0.00085282 * tF * rh * rh -
      0.00000199 * tF * tF * rh * rh;
    return ((hi - 32) * 5) / 9;
  }

  return airTempC;
}

/** Map temperature (°F) to a thermal RGB stroke colour (widget palette). */
export function thermalColorF(tempF: number, alpha = 1): string {
  const stops = [
    { t: 20, r: 56, g: 130, b: 255 },
    { t: 42, r: 45, g: 212, b: 255 },
    { t: 58, r: 56, g: 232, b: 255 },
    { t: 67, r: 46, g: 242, b: 184 },
    { t: 74, r: 255, g: 175, b: 64 },
    { t: 82, r: 255, g: 122, b: 56 },
    { t: 95, r: 255, g: 68, b: 79 },
  ];
  if (tempF <= stops[0]!.t) {
    const s = stops[0]!;
    return `rgba(${s.r}, ${s.g}, ${s.b}, ${alpha})`;
  }
  const last = stops[stops.length - 1]!;
  if (tempF >= last.t) return `rgba(${last.r}, ${last.g}, ${last.b}, ${alpha})`;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (tempF >= a.t && tempF <= b.t) {
      const ratio = (tempF - a.t) / (b.t - a.t);
      return `rgba(${Math.round(a.r + (b.r - a.r) * ratio)}, ${Math.round(a.g + (b.g - a.g) * ratio)}, ${Math.round(a.b + (b.b - a.b) * ratio)}, ${alpha})`;
    }
  }
  return `rgba(56, 232, 255, ${alpha})`;
}
