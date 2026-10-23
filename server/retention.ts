import { STATION_ID, type DB } from './db';
import { trimDiagnostics } from './ingest';
import { getStation } from './settings';

const BATCH = 5000;

/** Delete expired observations in small batches, yielding between them so live ingest is never blocked for long. */
export async function runRetention(db: DB, now = Date.now()): Promise<number> {
  const cutoff = now - getStation(db).retentionDays * 86_400_000;
  const del = db.prepare('DELETE FROM observation WHERE rowid IN (SELECT rowid FROM observation WHERE station_id = ? AND observed_at < ? LIMIT ?)');
  let total = 0;
  for (;;) {
    const n = del.run(STATION_ID, cutoff, BATCH).changes;
    total += n;
    if (n < BATCH) break;
    await new Promise((r) => setImmediate(r));
  }
  trimDiagnostics(db);
  db.prepare('DELETE FROM auth_session WHERE expires_at < ?').run(now);
  return total;
}

export function scheduleRetention(db: DB, everyMs = 3600_000) {
  const tick = () => runRetention(db).catch((e) => console.error('retention failed', e));
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, everyMs);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
