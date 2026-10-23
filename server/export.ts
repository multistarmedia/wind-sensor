import { once } from 'node:events';
import type { Response } from 'express';
import { STATION_ID, type DB } from './db';
import { getProfile } from './settings';

const PAGE = 2000;

export const CSV_COLUMNS = [
  'observation_id',
  'browser_received_utc',
  'server_received_utc',
  'capture_session_id',
  'input_profile_id',
  'sequence',
  'wind_speed_m_s',
  'wind_direction_deg',
  'wind_direction_reference',
  'air_temperature_c',
  'relative_humidity_pct',
  'station_pressure_hpa',
  'rain_field_mm',
  'solar_radiation_w_m2',
  'supply_voltage_v',
  'compass_heading_deg',
  'config',
  'quality_flags',
  'raw_record',
];

/** Quote per RFC 4180 and neutralise spreadsheet formulas in untrusted text. */
export function csvText(v: string | null | undefined): string {
  if (v == null || v === '') return '';
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Numbers are typed values: written as-is (negatives preserved), null as empty. */
export function csvNumber(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '';
  return String(Math.round(v * 10_000) / 10_000);
}

interface Row {
  rowid: number;
  id: string; session_id: string; profile_id: number; sequence: number;
  observed_at: number; server_received_at: number;
  ws: number; wd: number; at: number; rh: number; bp: number;
  rain: number | null; solar: number | null; bv: number | null; compass: number | null;
  config: string | null; quality_flags: string; raw: string;
}

/** Stream observations in pages so ingest requests keep getting the database between pages. */
export async function streamCsv(db: DB, res: Response, from: number, to: number) {
  const stmt = db.prepare(
    `SELECT rowid, * FROM observation
     WHERE station_id = ? AND observed_at >= ? AND observed_at < ? AND (observed_at > ? OR (observed_at = ? AND rowid > ?))
     ORDER BY observed_at, rowid LIMIT ?`,
  );
  const refCache = new Map<number, string>();
  const reference = (profileId: number) => {
    let r = refCache.get(profileId);
    if (r === undefined) {
      r = getProfile(db, profileId)?.directionReference ?? '';
      refCache.set(profileId, r);
    }
    return r;
  };

  let closed = false;
  res.on('close', () => { closed = true; });
  res.write(`${CSV_COLUMNS.join(',')}\r\n`);
  let lastT = from - 1;
  let lastId = 0;
  for (;;) {
    const rows = stmt.all(STATION_ID, from, to, lastT, lastT, lastId, PAGE) as Row[];
    if (rows.length === 0 || closed) break;
    let chunk = '';
    for (const r of rows) {
      chunk += [
        csvText(r.id), new Date(r.observed_at).toISOString(), new Date(r.server_received_at).toISOString(),
        csvText(r.session_id), String(r.profile_id), String(r.sequence),
        csvNumber(r.ws), csvNumber(r.wd), csvText(reference(r.profile_id)),
        csvNumber(r.at), csvNumber(r.rh), csvNumber(r.bp), csvNumber(r.rain), csvNumber(r.solar), csvNumber(r.bv), csvNumber(r.compass),
        csvText(r.config), csvText(r.quality_flags), csvText(r.raw),
      ].join(',') + '\r\n';
    }
    const last = rows[rows.length - 1]!;
    lastT = last.observed_at;
    lastId = last.rowid;
    if (!res.write(chunk)) await once(res, 'drain');
    else await new Promise((r) => setImmediate(r));
    if (rows.length < PAGE) break;
  }
  res.end();
}
