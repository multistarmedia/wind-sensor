// Shared period options for Wind Average / Peak / Mean direction summaries.

export const WIND_STAT_WINDOWS = [
  { id: '1s', label: '1 s', ms: 1_000 },
  { id: '1m', label: '1 min', ms: 60_000 },
  { id: '10m', label: '10 min', ms: 10 * 60_000 },
  { id: '20m', label: '20 min', ms: 20 * 60_000 },
  { id: '30m', label: '30 min', ms: 30 * 60_000 },
  { id: '1h', label: '1 hr', ms: 3600_000 },
  { id: '2h', label: '2 hr', ms: 2 * 3600_000 },
  { id: '3h', label: '3 hr', ms: 3 * 3600_000 },
  { id: '4h', label: '4 hr', ms: 4 * 3600_000 },
  { id: '6h', label: '6 hr', ms: 6 * 3600_000 },
  { id: '12h', label: '12 hr', ms: 12 * 3600_000 },
  { id: '24h', label: '24 hr', ms: 24 * 3600_000 },
  { id: '36h', label: '36 hr', ms: 36 * 3600_000 },
  { id: '48h', label: '48 hr', ms: 48 * 3600_000 },
  { id: '72h', label: '72 hr', ms: 72 * 3600_000 },
] as const;

export type WindStatWindowId = (typeof WIND_STAT_WINDOWS)[number]['id'];

export const DEFAULT_WIND_STAT_WINDOW: WindStatWindowId = '10m';

export function windStatWindow(id: string) {
  return WIND_STAT_WINDOWS.find((w) => w.id === id) ?? WIND_STAT_WINDOWS.find((w) => w.id === DEFAULT_WIND_STAT_WINDOW)!;
}
