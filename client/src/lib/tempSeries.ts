// Temperature profile series for the Live Temperature tile (range windows + overlays).

import { useMemo } from 'react';
import { cToDisplay } from '../../../shared/units';
import { dewPointC, feelsLikeC } from '../../../shared/thermo';
import { api } from './api';
import { usePoll } from './hooks';
import { useStationNow } from './station';

export const TEMP_WINDOWS = [
  { id: '1h', label: '1h', ms: 3600_000, subtitle: '1-Hour Thermal Trend' },
  { id: '3h', label: '3h', ms: 3 * 3600_000, subtitle: '3-Hour Short-Term Window' },
  { id: '6h', label: '6h', ms: 6 * 3600_000, subtitle: '6-Hour Thermal Window' },
  { id: '12h', label: '12h', ms: 12 * 3600_000, subtitle: '12-Hour Half-Day Profile' },
  { id: '18h', label: '18h', ms: 18 * 3600_000, subtitle: '18-Hour Extended Profile' },
  { id: '24h', label: '24h', ms: 24 * 3600_000, subtitle: '24-Hour Thermal Profile' },
  { id: '36h', label: '36h', ms: 36 * 3600_000, subtitle: '36-Hour Multi-Day Profile' },
  { id: '48h', label: '48h', ms: 48 * 3600_000, subtitle: '48-Hour Two-Day Profile' },
  { id: '72h', label: '72h', ms: 72 * 3600_000, subtitle: '72-Hour Three-Day Trend' },
  { id: '5d', label: '5 d', ms: 5 * 86_400_000, subtitle: '5-Day Extended Profile' },
  { id: '7d', label: '7 d', ms: 7 * 86_400_000, subtitle: '7-Day Weekly Thermal Trend' },
  { id: '10d', label: '10 d', ms: 10 * 86_400_000, subtitle: '10-Day Extended Profile' },
] as const;

/** Top row: 1h–24h. Bottom row: 36h–10 d. */
export const TEMP_WINDOW_ROWS = [TEMP_WINDOWS.slice(0, 6), TEMP_WINDOWS.slice(6)] as const;

export type TempWindowId = (typeof TEMP_WINDOWS)[number]['id'];

export interface TempPoint {
  t: number;
  temp: number | null;
  dew: number | null;
  feels: number | null;
}

type RecentObs = { t: number; m: { airTempC: number; rhPct: number; windSpeedMs: number } };

export function useTempProfile(windowId: TempWindowId) {
  const station = useStationNow();
  const win = TEMP_WINDOWS.find((w) => w.id === windowId) ?? TEMP_WINDOWS[5]!;
  const hist = usePoll(
    station.demo ? null : () => api.history(new Date(Date.now() - win.ms), new Date()),
    15_000,
    [win.ms],
  );

  const points = useMemo(() => {
    const show = (c: number | null) => (c == null ? null : cToDisplay(c, station.units.temp));

    // Demo never hits the server — build the full selected window locally so every pill changes the graph.
    if (station.demo) {
      return demoTempSeries(station.now, win.ms, station.cap.recent, show);
    }

    const recent = station.cap.recent;
    const recentSpan = recent.length > 0 ? station.now - recent[0]!.t : 0;
    if (recent.length > 0 && win.ms <= recentSpan + 60_000) {
      return fromRecent(recent, station.now - win.ms, show);
    }

    if (!hist.data) return [] as TempPoint[];
    return hist.data.points.map((p) => {
      const tempC = p.atAvg;
      const dewC = tempC == null || p.rhAvg == null ? null : dewPointC(tempC, p.rhAvg);
      const feelsC = tempC == null ? null : feelsLikeC(tempC, p.rhAvg ?? 50, p.wsAvg ?? 0);
      return { t: p.t, temp: show(tempC), dew: show(dewC), feels: show(feelsC) };
    });
  }, [station.demo, station.cap.recent, station.now, station.units.temp, win.ms, hist.data]);

  const extremes = useMemo(() => {
    let hi: TempPoint | null = null;
    let lo: TempPoint | null = null;
    for (const p of points) {
      if (p.temp == null) continue;
      if (!hi || p.temp > hi.temp!) hi = p;
      if (!lo || p.temp < lo.temp!) lo = p;
    }
    return { hi, lo };
  }, [points]);

  return { ...station, win, points, extremes, bucketMs: hist.data?.bucketMs ?? null };
}

/** Stable 0…1 from an integer seed (deterministic “weather” across re-renders). */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Demo weather: real diurnal swing (cool pre-dawn, warm mid-afternoon), day-to-day
 * baseline shifts, and a slow synoptic wiggle — so 48 h…10 d windows look like
 * several days of station data rather than a single sine.
 */
function syntheticWeather(tMs: number): { at: number; rh: number; ws: number } {
  const dayMs = 86_400_000;
  const dayIndex = Math.floor(tMs / dayMs);
  const dayFrac = (tMs % dayMs) / dayMs;
  const hour = dayFrac * 24;

  // Trough ~05:00, peak ~15:00.
  const diurnalPhase = ((hour - 5) / 24) * 2 * Math.PI;
  const diurnal = Math.sin(diurnalPhase - Math.PI / 2);

  const dayBias = (hash01(dayIndex) - 0.5) * 9;
  const prevBias = (hash01(dayIndex - 1) - 0.5) * 9;
  const baseline = prevBias + (dayBias - prevBias) * smooth01(dayFrac);

  // ~3–4 day weather pattern + mild weekly drift.
  const synoptic =
    2.8 * Math.sin((tMs / dayMs / 3.4) * 2 * Math.PI + 1.1) +
    1.4 * Math.sin((tMs / dayMs / 7.1) * 2 * Math.PI + 0.4);

  const dailyRange = 5.2 + hash01(dayIndex + 17) * 3.2; // ~5–8.5 °C day/night
  const mean = 15.5 + baseline + synoptic;
  const micro = (hash01(Math.floor(tMs / 900_000)) - 0.5) * 0.7;
  const at = mean + dailyRange * diurnal + micro;

  // Humidity rises at night and on cooler days.
  const rh = Math.min(
    95,
    Math.max(28, 58 - 14 * diurnal - baseline * 1.2 + (hash01(dayIndex + 5) - 0.5) * 8),
  );
  const breezyDay = hash01(dayIndex + 9) > 0.62;
  const ws = Math.max(
    0.2,
    3.5 +
      (breezyDay ? 4 : 0) +
      2.2 * Math.max(0, diurnal) +
      (hash01(Math.floor(tMs / 1_800_000) + 3) - 0.5) * 2.5,
  );
  return { at, rh, ws };
}

/**
 * 3 h…36 h demo: one smooth diurnal arc (plus a gentle multi-hour drift).
 * No 15-min hash steps and no ~1 h sine — those read as too many peaks/valleys.
 */
function syntheticMedium(tMs: number): { at: number; rh: number; ws: number } {
  const dayMs = 86_400_000;
  const dayIndex = Math.floor(tMs / dayMs);
  const dayFrac = (tMs % dayMs) / dayMs;
  const hour = dayFrac * 24;

  const diurnalPhase = ((hour - 5) / 24) * 2 * Math.PI;
  const diurnal = Math.sin(diurnalPhase - Math.PI / 2);

  const dayBias = (hash01(dayIndex) - 0.5) * 5;
  const prevBias = (hash01(dayIndex - 1) - 0.5) * 5;
  const baseline = prevBias + (dayBias - prevBias) * smooth01(dayFrac);

  // One slow bend across the window, not a chain of local extrema.
  const drift = 1.1 * Math.sin((tMs / dayMs / 2.2) * 2 * Math.PI + 0.7);

  const dailyRange = 5.5 + hash01(dayIndex + 17) * 2.2;
  const mean = 15.5 + baseline + drift;
  const at = mean + dailyRange * diurnal;

  const rh = Math.min(
    95,
    Math.max(28, 58 - 14 * diurnal - baseline * 1.1 + (hash01(dayIndex + 5) - 0.5) * 4),
  );
  const ws = Math.max(0.3, 3.2 + 2.0 * Math.max(0, diurnal) + (hash01(dayIndex + 9) > 0.62 ? 2.5 : 0));
  return { at, rh, ws };
}

/** 1 h demo filler only — live buffer usually covers most of this window. */
function syntheticShort(tMs: number): { at: number; rh: number; ws: number } {
  const weather = syntheticMedium(tMs);
  const sec = tMs / 1000;
  // Mild, long-period nudge only (period ≫ 1 h), so a partial hour stays nearly monotonic.
  return {
    at: weather.at + 0.35 * Math.sin(sec / 2200),
    rh: weather.rh,
    ws: weather.ws,
  };
}

function demoTempSeries(
  now: number,
  windowMs: number,
  recent: RecentObs[],
  show: (c: number | null) => number | null,
): TempPoint[] {
  const dayMs = 86_400_000;
  const hourMs = 3600_000;
  const longWindow = windowMs >= 48 * hourMs;
  const mediumWindow = windowMs >= 3 * hourMs && !longWindow;
  // Fewer samples on medium ranges keep the SVG path from looking sawtoothed.
  const perDay = longWindow ? 12 : mediumWindow ? 16 : 24;
  const n = Math.min(480, Math.max(mediumWindow ? 96 : 180, Math.round((windowMs / dayMs) * perDay)));
  const step = windowMs / Math.max(1, n - 1);
  const sample = longWindow ? syntheticWeather : mediumWindow ? syntheticMedium : syntheticShort;

  const out: TempPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = now - windowMs + i * step;
    const { at, rh, ws } = sample(t);
    out.push({
      t,
      temp: show(at),
      dew: show(dewPointC(at, rh)),
      feels: show(feelsLikeC(at, rh, ws)),
    });
  }

  // Medium/long windows: keep the curve smooth — only pin the tip to the live reading.
  // Short (1 h): splice the live buffer so the chart tracks the simulator.
  if (mediumWindow || longWindow) {
    const last = recent[recent.length - 1];
    if (!last || out.length === 0) return out;
    const tip = out[out.length - 1]!;
    tip.t = Math.max(tip.t, last.t);
    tip.temp = show(last.m.airTempC);
    tip.dew = show(dewPointC(last.m.airTempC, last.m.rhPct));
    tip.feels = show(feelsLikeC(last.m.airTempC, last.m.rhPct, last.m.windSpeedMs));
    return out;
  }

  const live = fromRecent(recent, now - windowMs, show);
  if (live.length === 0) return out;
  const liveStart = live[0]!.t;
  return [...out.filter((p) => p.t < liveStart), ...live];
}

function fromRecent(
  recent: RecentObs[],
  since: number,
  show: (c: number | null) => number | null,
): TempPoint[] {
  const slice = recent.filter((o) => o.t >= since);
  if (slice.length === 0) return [];
  const size = Math.max(1, Math.ceil(slice.length / 220));
  const out: TempPoint[] = [];
  for (let i = 0; i < slice.length; i += size) {
    const group = slice.slice(i, i + size);
    const last = group[group.length - 1]!;
    const avg = (pick: (m: typeof last.m) => number) => group.reduce((a, o) => a + pick(o.m), 0) / group.length;
    const tempC = avg((m) => m.airTempC);
    const rh = avg((m) => m.rhPct);
    const ws = avg((m) => m.windSpeedMs);
    out.push({
      t: last.t,
      temp: show(tempC),
      dew: show(dewPointC(tempC, rh)),
      feels: show(feelsLikeC(tempC, rh, ws)),
    });
  }
  return out;
}
