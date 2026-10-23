import type { BatchRecord, BatchResponse, IngestRejectCode } from '../shared/api';
import { MAX_BATCH_RECORDS } from '../shared/api';
import { parseRecord } from '../shared/parser';
import type { InputProfile } from '../shared/profile';
import { STATION_ID, type DB } from './db';
import { getProfile } from './settings';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const MAX_DIAGNOSTIC_EVENTS = 1000;

export class IngestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

export function recordDiagnostic(db: DB, e: { code: string; message: string; sample?: string | null; sessionId?: string | null }) {
  db.prepare('INSERT INTO diagnostic_event (at, station_id, session_id, code, message, sample) VALUES (?, ?, ?, ?, ?, ?)')
    .run(Date.now(), STATION_ID, e.sessionId ?? null, e.code, e.message.slice(0, 500), e.sample?.slice(0, 600) ?? null);
}

export function trimDiagnostics(db: DB) {
  db.prepare(
    'DELETE FROM diagnostic_event WHERE id <= (SELECT id FROM diagnostic_event ORDER BY id DESC LIMIT 1 OFFSET ?)',
  ).run(MAX_DIAGNOSTIC_EVENTS);
}

/** Register a browser capture session (idempotent). */
export function upsertCaptureSession(
  db: DB,
  s: { id: string; profileId: number; sourceType: string; userAgent?: string | null; startedAt: number },
) {
  const existing = db.prepare('SELECT profile_id FROM capture_session WHERE id = ?').get(s.id) as { profile_id: number } | undefined;
  if (existing) {
    if (existing.profile_id !== s.profileId) {
      throw new IngestError(409, 'profile_mismatch', 'This capture session was started with a different input profile');
    }
    db.prepare('UPDATE capture_session SET last_heartbeat_at = ? WHERE id = ?').run(Date.now(), s.id);
    return;
  }
  if (!getProfile(db, s.profileId)) throw new IngestError(422, 'missing_profile', `Input profile ${s.profileId} does not exist`);
  db.prepare(
    `INSERT INTO capture_session (id, station_id, profile_id, source_type, user_agent, started_at, last_heartbeat_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(s.id, STATION_ID, s.profileId, s.sourceType, s.userAgent?.slice(0, 300) ?? null, s.startedAt, Date.now());
}

export function endCaptureSession(db: DB, id: string) {
  db.prepare('UPDATE capture_session SET ended_at = ?, last_heartbeat_at = ? WHERE id = ? AND ended_at IS NULL').run(Date.now(), Date.now(), id);
}

export function ingestBatch(db: DB, body: unknown, opts: { retentionDays: number; userAgent?: string; now?: number }): BatchResponse {
  const now = opts.now ?? Date.now();
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isUuid(b.captureSessionId)) throw new IngestError(400, 'invalid_request', 'captureSessionId must be a UUID');
  if (!Number.isInteger(b.profileId)) throw new IngestError(400, 'invalid_request', 'profileId must be an integer');
  if (!Array.isArray(b.records)) throw new IngestError(400, 'invalid_request', 'records must be an array');
  if (b.records.length > MAX_BATCH_RECORDS) {
    throw new IngestError(413, 'request_too_large', `At most ${MAX_BATCH_RECORDS} records per request`);
  }
  const sessionId = b.captureSessionId;
  const profileId = b.profileId as number;

  const profile = getProfile(db, profileId);
  const response: BatchResponse = { accepted: [], duplicates: [], rejected: [], serverTime: new Date(now).toISOString() };
  const records = b.records as unknown[];

  const rejectAll = (code: IngestRejectCode, message: string) => {
    for (const r of records) {
      const id = (r as Partial<BatchRecord>)?.id;
      response.rejected.push({ id: typeof id === 'string' ? id.slice(0, 64) : '', code, message });
    }
    recordDiagnostic(db, { code, message, sessionId });
    return response;
  };
  if (!profile) return rejectAll('missing_profile', `Input profile ${profileId} does not exist on the server`);
  if (!profile.unitsConfirmed) return rejectAll('units_unconfirmed', 'The input profile units were never confirmed');

  const oldest = now - opts.retentionDays * 86_400_000;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO observation
      (id, station_id, session_id, profile_id, sequence, observed_at, server_received_at,
       ws, wd, at, rh, bp, rain, solar, bv, compass, config, raw, quality_flags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    const first = records[0] as Partial<BatchRecord> | undefined;
    const firstAt = typeof first?.observedAt === 'string' ? Date.parse(first.observedAt) : NaN;
    upsertCaptureSession(db, {
      id: sessionId, profileId, sourceType: 'web_serial', userAgent: opts.userAgent,
      startedAt: Number.isFinite(firstAt) ? firstAt : now,
    });

    for (const item of records) {
      const r = (item ?? {}) as Partial<BatchRecord>;
      const id = typeof r.id === 'string' ? r.id : '';
      const reject = (code: IngestRejectCode, message: string) => {
        response.rejected.push({ id: id.slice(0, 64), code, message });
        recordDiagnostic(db, { code, message, sample: typeof r.raw === 'string' ? r.raw : null, sessionId });
      };
      if (!isUuid(id)) { reject('invalid_record', 'Record id must be a UUID'); continue; }
      if (!Number.isInteger(r.sequence) || (r.sequence as number) < 0) { reject('invalid_record', 'sequence must be a non-negative integer'); continue; }
      if (typeof r.raw !== 'string') { reject('invalid_record', 'raw must be a string'); continue; }
      if (typeof r.observedAt !== 'string' || !ISO_UTC.test(r.observedAt)) { reject('invalid_timestamp', 'observedAt must be an ISO-8601 UTC timestamp'); continue; }
      const at = Date.parse(r.observedAt);
      if (!Number.isFinite(at)) { reject('invalid_timestamp', 'observedAt is not a valid date'); continue; }
      if (at > now + FUTURE_TOLERANCE_MS) { reject('invalid_timestamp', 'observedAt is in the future; check the capture computer clock'); continue; }
      if (at < oldest) { reject('invalid_timestamp', 'observedAt is older than the retention period'); continue; }

      const parsed = parseRecord(r.raw, profile);
      if (!parsed.ok) { reject(parsed.code, parsed.message); continue; }

      const flags: string[] = [];
      if (now - at > 60_000) flags.push('late_upload');
      if (at > now + 60_000) flags.push('client_clock_ahead');
      const m = parsed.measurements;
      const result = insert.run(
        id, STATION_ID, sessionId, profileId, r.sequence, at, now,
        m.windSpeedMs, m.windDirDeg, m.airTempC, m.rhPct, m.pressureHpa,
        m.rainMm, m.solarWm2, m.supplyV, m.compassDeg, parsed.config, r.raw, flags.join(' '),
      );
      (result.changes === 1 ? response.accepted : response.duplicates).push(id);
    }
  })();

  return response;
}

export type { InputProfile };
