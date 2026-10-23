// Wind helpers: compass names, circular means, Beaufort speed bands.

/** Below this speed, direction is not meaningful and the display shows "Calm" (Beaufort force 0, < 0.3 m/s). */
export const CALM_THRESHOLD_MS = 0.3;

/**
 * Mean resultant length below which the vector mean of directions is treated as undefined
 * (directions cancel, e.g. equal N and S readings).
 */
export const MIN_RESULTANT = 0.05;

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassPoint(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
}

export function isCalm(speedMs: number | null | undefined): boolean {
  return speedMs == null || speedMs < CALM_THRESHOLD_MS;
}

/** Circular mean from accumulated unit-vector sums; null when undefined. */
export function meanDirectionFromSums(sumSin: number, sumCos: number, n: number): number | null {
  if (n <= 0) return null;
  const r = Math.hypot(sumSin, sumCos) / n;
  if (r < MIN_RESULTANT) return null;
  const deg = (Math.atan2(sumSin, sumCos) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Unit-vector mean of directions, ignoring calm samples (direction-only, sample-weighted). */
export function meanDirection(samples: { dir: number; speed: number }[]): number | null {
  let s = 0;
  let c = 0;
  let n = 0;
  for (const x of samples) {
    if (isCalm(x.speed)) continue;
    const r = (x.dir * Math.PI) / 180;
    s += Math.sin(r);
    c += Math.cos(r);
    n++;
  }
  return meanDirectionFromSums(s, c, n);
}

/** Lower edges in m/s of Beaufort forces 1–12 (WMO). Index i is force i+1. */
export const BEAUFORT_EDGES_MS = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];

export const BEAUFORT_NAMES = [
  'Light air', 'Light breeze', 'Gentle breeze', 'Moderate breeze', 'Fresh breeze', 'Strong breeze',
  'Near gale', 'Gale', 'Strong gale', 'Storm', 'Violent storm', 'Hurricane force',
];

/** 0 = calm, 1–12 = Beaufort force. */
export function beaufortForce(speedMs: number): number {
  let f = 0;
  for (let i = 0; i < BEAUFORT_EDGES_MS.length; i++) if (speedMs >= BEAUFORT_EDGES_MS[i]!) f = i + 1;
  return f;
}

/** Sector index 0–15, sector 0 centred on north. */
export function sectorIndex(deg: number, sectors = 16): number {
  const width = 360 / sectors;
  return Math.floor(((((deg + width / 2) % 360) + 360) % 360) / width);
}
