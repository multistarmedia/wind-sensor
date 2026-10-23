// Summaries computed in the browser from local readings (demo mode only, so demo never touches the server).

import type { StatusResponse, WindRoseResponse } from '../../../shared/api';
import { startOfZonedDay } from '../../../shared/time';
import { beaufortForce, isCalm, meanDirection, sectorIndex } from '../../../shared/wind';
import type { LocalObservation } from '../capture/controller';

export function localStatus(recent: LocalObservation[], tz: string, now = Date.now()): StatusResponse {
  const last = recent[recent.length - 1];
  const ten = recent.filter((o) => o.t >= now - 600_000);
  const dayStart = startOfZonedDay(tz, now);
  const today = recent.filter((o) => o.t >= dayStart);
  const by = <K extends keyof LocalObservation['m']>(list: LocalObservation[], k: K, dir: 1 | -1) =>
    list.reduce<LocalObservation | null>((best, o) => (best === null || (o.m[k]! as number) * dir > (best.m[k]! as number) * dir ? o : best), null);
  const peak10 = by(ten, 'windSpeedMs', 1);
  const hi = by(today, 'airTempC', 1);
  const lo = by(today, 'airTempC', -1);
  const pk = by(today, 'windSpeedMs', 1);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const bpNow = avg(ten.map((o) => o.m.pressureHpa));
  const then = recent.filter((o) => Math.abs(o.t - (now - 3 * 3600_000)) <= 300_000);
  const bpThen = avg(then.map((o) => o.m.pressureHpa));
  const iso = (t?: number) => (t === undefined ? null : new Date(t).toISOString());
  return {
    serverTime: new Date(now).toISOString(),
    latest: last ? { id: 'demo', observedAt: iso(last.t)!, serverReceivedAt: iso(last.t)!, m: last.m } : null,
    freshness: { ageMs: last ? now - last.t : null, stale: !last || now - last.t > 10_000, staleThresholdMs: 10_000 },
    capture: { active: true, lastHeartbeatAt: iso(now) },
    last10min: {
      samples: ten.length,
      avgSpeedMs: avg(ten.map((o) => o.m.windSpeedMs)),
      peakSpeedMs: peak10?.m.windSpeedMs ?? null,
      peakAt: iso(peak10?.t),
      meanDirDeg: meanDirection(ten.map((o) => ({ dir: o.m.windDirDeg, speed: o.m.windSpeedMs }))),
    },
    today: {
      start: iso(dayStart)!, samples: today.length,
      tempHighC: hi?.m.airTempC ?? null, tempHighAt: iso(hi?.t),
      tempLowC: lo?.m.airTempC ?? null, tempLowAt: iso(lo?.t),
      peakWindMs: pk?.m.windSpeedMs ?? null, peakWindAt: iso(pk?.t),
    },
    pressureTrend: { windowHours: 3, changeHpa: bpNow !== null && bpThen !== null ? bpNow - bpThen : null },
    recent: recent.slice(-60).map((o) => ({ t: o.t, ws: o.m.windSpeedMs, wd: o.m.windDirDeg })),
  };
}

export function localWindRose(recent: LocalObservation[], fromMs: number, toMs: number): WindRoseResponse {
  const counts = Array.from({ length: 16 }, () => Array<number>(12).fill(0));
  let total = 0;
  let calm = 0;
  for (const o of recent) {
    if (o.t < fromMs || o.t >= toMs) continue;
    total++;
    if (isCalm(o.m.windSpeedMs) || beaufortForce(o.m.windSpeedMs) === 0) {
      calm++;
      continue;
    }
    counts[sectorIndex(o.m.windDirDeg)]![beaufortForce(o.m.windSpeedMs) - 1]!++;
  }
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), total, calm, counts };
}
