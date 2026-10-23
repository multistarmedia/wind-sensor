import type {
  DiagnosticsResponse, HistoryPoint, HistoryResponse, LogResponse, LogRow, ObservationView, StatusResponse, WindRoseResponse,
} from '../shared/api';
import { MAX_RANGE_MS } from '../shared/api';
import { bucketSizeMs } from '../shared/buckets';
import { staleThresholdMs } from '../shared/profile';
import { startOfZonedDay } from '../shared/time';
import { BEAUFORT_EDGES_MS, CALM_THRESHOLD_MS, meanDirectionFromSums } from '../shared/wind';
import { STATION_ID, type DB } from './db';
import { getProfile, getStation } from './settings';

interface ObsRow {
  rowid: number;
  id: string;
  session_id: string;
  profile_id: number;
  observed_at: number;
  server_received_at: number;
  ws: number; wd: number; at: number; rh: number; bp: number;
  rain: number | null; solar: number | null; bv: number | null; compass: number | null;
  config: string | null;
  raw: string;
}

const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());

function measurements(r: ObsRow) {
  return {
    windSpeedMs: r.ws, windDirDeg: r.wd, airTempC: r.at, rhPct: r.rh, pressureHpa: r.bp,
    rainMm: r.rain, solarWm2: r.solar, supplyV: r.bv, compassDeg: r.compass,
  };
}

export class RangeError400 extends Error {}

/** Parse and bound a from/to query (ISO strings). Defaults to the last 24 hours. */
export function parseRange(q: Record<string, unknown>, now = Date.now(), defaultMs = 24 * 3600_000) {
  const to = q.to === undefined ? now : Date.parse(String(q.to));
  const from = q.from === undefined ? to - defaultMs : Date.parse(String(q.from));
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new RangeError400('from and to must be ISO-8601 timestamps');
  if (from >= to) throw new RangeError400('from must be before to');
  if (to - from > MAX_RANGE_MS) throw new RangeError400('Ranges are limited to 31 days per request');
  return { from, to };
}

export function status(db: DB, now = Date.now()): StatusResponse {
  const station = getStation(db);
  const profile = station.currentProfileId ? getProfile(db, station.currentProfileId) : null;
  const threshold = staleThresholdMs(profile?.intervalSeconds ?? 1);

  const latestRow = db.prepare(
    'SELECT rowid, * FROM observation WHERE station_id = ? ORDER BY observed_at DESC LIMIT 1',
  ).get(STATION_ID) as ObsRow | undefined;
  const latest: ObservationView | null = latestRow
    ? { id: latestRow.id, observedAt: iso(latestRow.observed_at)!, serverReceivedAt: iso(latestRow.server_received_at)!, m: measurements(latestRow) }
    : null;
  const ageMs = latestRow ? Math.max(0, now - latestRow.observed_at) : null;

  const tenAgo = now - 10 * 60_000;
  const w = db.prepare(
    `SELECT COUNT(*) n, AVG(ws) avg, MAX(ws) peak,
            SUM(CASE WHEN ws >= @calm THEN sin(radians(wd)) END) s,
            SUM(CASE WHEN ws >= @calm THEN cos(radians(wd)) END) c,
            SUM(CASE WHEN ws >= @calm THEN 1 ELSE 0 END) nd
     FROM observation WHERE station_id = @st AND observed_at >= @from AND observed_at <= @to`,
  ).get({ st: STATION_ID, calm: CALM_THRESHOLD_MS, from: tenAgo, to: now }) as { n: number; avg: number | null; peak: number | null; s: number | null; c: number | null; nd: number | null };
  const peakRow = w.n
    ? (db.prepare('SELECT observed_at FROM observation WHERE station_id = ? AND observed_at >= ? AND observed_at <= ? ORDER BY ws DESC, observed_at DESC LIMIT 1')
        .get(STATION_ID, tenAgo, now) as { observed_at: number })
    : undefined;

  const dayStart = startOfZonedDay(station.timeZone, now);
  const extreme = (col: 'at' | 'ws', dir: 'ASC' | 'DESC') =>
    db.prepare(`SELECT ${col} v, observed_at t FROM observation WHERE station_id = ? AND observed_at >= ? AND observed_at <= ? ORDER BY ${col} ${dir}, observed_at DESC LIMIT 1`)
      .get(STATION_ID, dayStart, now) as { v: number; t: number } | undefined;
  const dayCount = (db.prepare('SELECT COUNT(*) n FROM observation WHERE station_id = ? AND observed_at >= ? AND observed_at <= ?')
    .get(STATION_ID, dayStart, now) as { n: number }).n;
  const hi = extreme('at', 'DESC');
  const lo = extreme('at', 'ASC');
  const pk = extreme('ws', 'DESC');

  // Pressure change: mean of the last 10 minutes vs. mean of a 10-minute window 3 hours earlier.
  const bpAvg = (from: number, to: number) =>
    (db.prepare('SELECT AVG(bp) v FROM observation WHERE station_id = ? AND observed_at >= ? AND observed_at <= ?').get(STATION_ID, from, to) as { v: number | null }).v;
  const bpNow = bpAvg(tenAgo, now);
  const bpThen = bpAvg(now - 3 * 3600_000 - 5 * 60_000, now - 3 * 3600_000 + 5 * 60_000);

  const recent = (db.prepare('SELECT observed_at t, ws, wd FROM observation WHERE station_id = ? AND observed_at >= ? ORDER BY observed_at DESC LIMIT 60')
    .all(STATION_ID, now - 5 * 60_000) as { t: number; ws: number; wd: number }[]).reverse();

  const hb = db.prepare('SELECT MAX(last_heartbeat_at) t FROM capture_session WHERE station_id = ? AND ended_at IS NULL').get(STATION_ID) as { t: number | null };

  return {
    serverTime: new Date(now).toISOString(),
    latest,
    freshness: { ageMs, stale: ageMs === null || ageMs > threshold, staleThresholdMs: threshold },
    capture: { active: hb.t !== null && now - hb.t < 30_000, lastHeartbeatAt: iso(hb.t) },
    last10min: {
      samples: w.n,
      avgSpeedMs: w.avg,
      peakSpeedMs: w.peak,
      peakAt: iso(peakRow?.observed_at),
      meanDirDeg: meanDirectionFromSums(w.s ?? 0, w.c ?? 0, w.nd ?? 0),
    },
    today: {
      start: iso(dayStart)!,
      samples: dayCount,
      tempHighC: hi?.v ?? null, tempHighAt: iso(hi?.t),
      tempLowC: lo?.v ?? null, tempLowAt: iso(lo?.t),
      peakWindMs: pk?.v ?? null, peakWindAt: iso(pk?.t),
    },
    pressureTrend: { windowHours: 3, changeHpa: bpNow !== null && bpThen !== null ? bpNow - bpThen : null },
    recent,
  };
}

/** Sample-weighted aggregation into fixed buckets; empty buckets stay null so charts show gaps. */
export function history(db: DB, from: number, to: number): HistoryResponse {
  const bucket = bucketSizeMs(to - from);
  const start = Math.floor(from / bucket) * bucket;
  const rows = db.prepare(
    `SELECT CAST((observed_at - @start) / @bucket AS INTEGER) b, COUNT(*) n,
            AVG(ws) wsAvg, MAX(ws) wsMax,
            SUM(CASE WHEN ws >= @calm THEN sin(radians(wd)) END) s,
            SUM(CASE WHEN ws >= @calm THEN cos(radians(wd)) END) c,
            SUM(CASE WHEN ws >= @calm THEN 1 ELSE 0 END) nd,
            AVG(at) atAvg, MIN(at) atMin, MAX(at) atMax,
            AVG(rh) rhAvg,
            AVG(bp) bpAvg, MIN(bp) bpMin, MAX(bp) bpMax,
            AVG(solar) srAvg, MAX(solar) srMax,
            AVG(bv) bvAvg
     FROM observation
     WHERE station_id = @st AND observed_at >= @from AND observed_at < @to
     GROUP BY b ORDER BY b`,
  ).all({ st: STATION_ID, start, bucket, from, to, calm: CALM_THRESHOLD_MS }) as (Omit<HistoryPoint, 't' | 'dir'> & { b: number; s: number | null; c: number | null; nd: number })[];

  const byBucket = new Map(rows.map((r) => [r.b, r]));
  const points: HistoryPoint[] = [];
  for (let t = start, b = 0; t < to; t += bucket, b++) {
    const r = byBucket.get(b);
    points.push(
      r
        ? {
            t, n: r.n, wsAvg: r.wsAvg, wsMax: r.wsMax, dir: meanDirectionFromSums(r.s ?? 0, r.c ?? 0, r.nd),
            atAvg: r.atAvg, atMin: r.atMin, atMax: r.atMax, rhAvg: r.rhAvg, bpAvg: r.bpAvg, bpMin: r.bpMin, bpMax: r.bpMax,
            srAvg: r.srAvg, srMax: r.srMax, bvAvg: r.bvAvg,
          }
        : { t, n: 0, wsAvg: null, wsMax: null, dir: null, atAvg: null, atMin: null, atMax: null, rhAvg: null, bpAvg: null, bpMin: null, bpMax: null, srAvg: null, srMax: null, bvAvg: null },
    );
  }
  return { from: iso(from)!, to: iso(to)!, bucketMs: bucket, points };
}

const FORCE_SQL = `CASE ${[...BEAUFORT_EDGES_MS].reverse().map((e, i) => `WHEN ws >= ${e} THEN ${12 - i}`).join(' ')} ELSE 0 END`;

/** Wind rose counts: 16 sectors × Beaufort forces 1–12, calm counted separately. */
export function windRose(db: DB, from: number, to: number): WindRoseResponse {
  const rows = db.prepare(
    `SELECT CAST(((wd + 11.25) - 360.0 * floor((wd + 11.25) / 360.0)) / 22.5 AS INTEGER) sector,
            ${FORCE_SQL} force, COUNT(*) n
     FROM observation WHERE station_id = ? AND observed_at >= ? AND observed_at < ?
     GROUP BY sector, force`,
  ).all(STATION_ID, from, to) as { sector: number; force: number; n: number }[];
  const counts = Array.from({ length: 16 }, () => Array<number>(12).fill(0));
  let total = 0;
  let calm = 0;
  for (const r of rows) {
    total += r.n;
    if (r.force === 0) calm += r.n;
    else counts[r.sector % 16]![r.force - 1]! += r.n;
  }
  return { from: iso(from)!, to: iso(to)!, total, calm, counts };
}

const LOG_PAGE = 200;

/** Newest-first log pages using a (observed_at, rowid) cursor. */
export function log(db: DB, q: Record<string, unknown>): LogResponse {
  let rows: ObsRow[];
  const limit = Math.min(Math.max(Number(q.limit) || LOG_PAGE, 1), 1000);
  if (typeof q.before === 'string' && /^\d+_\d+$/.test(q.before)) {
    const [t, id] = q.before.split('_').map(Number) as [number, number];
    rows = db.prepare(
      `SELECT rowid, * FROM observation WHERE station_id = ? AND (observed_at < ? OR (observed_at = ? AND rowid < ?))
       ORDER BY observed_at DESC, rowid DESC LIMIT ?`,
    ).all(STATION_ID, t, t, id, limit) as ObsRow[];
  } else {
    rows = db.prepare('SELECT rowid, * FROM observation WHERE station_id = ? ORDER BY observed_at DESC, rowid DESC LIMIT ?').all(STATION_ID, limit) as ObsRow[];
  }
  const last = rows[rows.length - 1];
  return {
    rows: rows.map((r): LogRow => ({
      id: r.id, observedAt: iso(r.observed_at)!, serverReceivedAt: iso(r.server_received_at)!, sessionId: r.session_id,
      profileId: r.profile_id, m: measurements(r), config: r.config, raw: r.raw,
    })),
    nextBefore: rows.length === limit && last ? `${last.observed_at}_${last.rowid}` : null,
  };
}

export function diagnostics(db: DB): DiagnosticsResponse {
  const events = db.prepare('SELECT at, code, message, sample, session_id FROM diagnostic_event ORDER BY id DESC LIMIT 200').all() as
    { at: number; code: string; message: string; sample: string | null; session_id: string | null }[];
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const pageCount = db.pragma('page_count', { simple: true }) as number;
  const pageSize = db.pragma('page_size', { simple: true }) as number;
  return {
    events: events.map((e) => ({ at: iso(e.at)!, code: e.code, message: e.message, sample: e.sample, sessionId: e.session_id })),
    counters: {
      observations: count('SELECT COUNT(*) n FROM observation'),
      rejected: count('SELECT COUNT(*) n FROM diagnostic_event'),
      sessions: count('SELECT COUNT(*) n FROM capture_session'),
      dbBytes: pageCount * pageSize,
    },
  };
}
