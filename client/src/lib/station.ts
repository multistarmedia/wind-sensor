// Live station readings shared by the wind view and the other weather modules.

import { useMemo } from 'react';
import type { HistoryPoint } from '../../../shared/api';
import type { Measurements } from '../../../shared/parser';
import { staleThresholdMs } from '../../../shared/profile';
import { cToDisplay, hpaToDisplay, type DisplayUnits } from '../../../shared/units';
import { api } from './api';
import { useApp } from './context';
import { useCapture, useNow, usePoll } from './hooks';
import { localStatus } from './local';

export function useStationNow() {
  const { settings, setSettings, navigate } = useApp();
  const cap = useCapture();
  const now = useNow(1000);
  const units = settings.station.displayUnits;
  const tz = settings.station.timeZone;
  const demo = cap.mode === 'demo';
  const profile = demo ? cap.profile : settings.profile;
  const serverStatus = usePoll(demo ? null : () => api.status(), 2000);
  const status = demo ? localStatus(cap.recent, tz, now) : serverStatus.data;

  // The capturing browser shows its own latest reading; viewers show what the server has saved.
  const localLive = cap.mode !== 'off' && cap.recent.length > 0;
  const latestM = localLive ? cap.recent[cap.recent.length - 1]!.m : status?.latest?.m ?? null;
  const latestAt = localLive ? cap.recent[cap.recent.length - 1]!.t : status?.latest ? Date.parse(status.latest.observedAt) : null;
  const threshold = staleThresholdMs(profile?.intervalSeconds ?? 1);
  const stale = latestAt === null || now - latestAt > threshold;

  const setUnits = async (patch: Partial<DisplayUnits>) => {
    const displayUnits = { ...units, ...patch };
    // Demo never writes to the server; still update in-memory display units so module toggles work.
    if (demo) {
      setSettings({ ...settings, station: { ...settings.station, displayUnits } });
      return;
    }
    setSettings(await api.updateSettings({ station: { displayUnits } }));
  };

  return { settings, setSettings, navigate, cap, now, units, tz, demo, profile, status, latestM, latestAt, stale, setUnits };
}

export type DaySeriesId = 'temp' | 'humidity' | 'pressure' | 'solar' | 'supply';

export interface DayPoint {
  t: number;
  v: number | null;
  lo: number | null;
  hi: number | null;
}

/** Saved readings for the window (default 24 h), or the demo buffer held in this browser. */
export function useDaySeries(id: DaySeriesId, windowMs = 86_400_000) {
  const station = useStationNow();
  const hist = usePoll(
    station.demo ? null : () => api.history(new Date(Date.now() - windowMs), new Date()),
    15_000,
    [windowMs],
  );
  const points = useMemo(() => {
    const display = (v: number) => toDisplay(v, id, station.units);
    if (station.demo) {
      const since = station.now - windowMs;
      const recent = station.cap.recent.filter((o) => o.t >= since);
      return bucketRecent(recent, (m) => measure(m, id), display);
    }
    if (!hist.data) return [];
    return hist.data.points.map((p) => {
      const raw = historyValue(p, id);
      return {
        t: p.t,
        v: raw.v == null ? null : display(raw.v),
        lo: raw.lo == null ? null : display(raw.lo),
        hi: raw.hi == null ? null : display(raw.hi),
      };
    });
  }, [id, windowMs, station.demo, station.units, station.now, station.demo ? station.cap.recent : hist.data]);
  const empty = points.length === 0 || points.every((p) => p.v == null);
  const bucketMs = station.demo ? null : hist.data?.bucketMs ?? null;
  return { ...station, points, empty, bucketMs, histError: hist.error };
}

function measure(m: Measurements, id: DaySeriesId): number | null {
  switch (id) {
    case 'temp': return m.airTempC;
    case 'humidity': return m.rhPct;
    case 'pressure': return m.pressureHpa;
    case 'solar': return m.solarWm2;
    case 'supply': return m.supplyV;
  }
}

function historyValue(p: HistoryPoint, id: DaySeriesId): { v: number | null; lo: number | null; hi: number | null } {
  switch (id) {
    case 'temp': return { v: p.atAvg, lo: p.atMin, hi: p.atMax };
    case 'humidity': return { v: p.rhAvg, lo: null, hi: null };
    case 'pressure': return { v: p.bpAvg, lo: p.bpMin, hi: p.bpMax };
    case 'solar': return { v: p.srAvg, lo: null, hi: p.srMax };
    case 'supply': return { v: p.bvAvg, lo: null, hi: null };
  }
}

function toDisplay(v: number, id: DaySeriesId, units: DisplayUnits): number {
  if (id === 'temp') return cToDisplay(v, units.temp);
  if (id === 'pressure') return hpaToDisplay(v, units.pressure);
  return v;
}

function bucketRecent(
  recent: { t: number; m: Measurements }[],
  read: (m: Measurements) => number | null,
  display: (v: number) => number,
): DayPoint[] {
  if (recent.length === 0) return [];
  const size = Math.max(1, Math.ceil(recent.length / 180));
  const out: DayPoint[] = [];
  for (let i = 0; i < recent.length; i += size) {
    const slice = recent.slice(i, i + size);
    const vals = slice
      .map((o) => read(o.m))
      .filter((v): v is number => v != null && Number.isFinite(v))
      .map(display);
    out.push({
      t: slice[slice.length - 1]!.t,
      v: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      lo: vals.length ? Math.min(...vals) : null,
      hi: vals.length ? Math.max(...vals) : null,
    });
  }
  return out;
}
