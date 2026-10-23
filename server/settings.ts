import type { SettingsResponse, StationSettings } from '../shared/api';
import { pickProfileSettings, sameInterpretation, validateProfileSettings, type InputProfile, type ProfileSettings } from '../shared/profile';
import { isValidTimeZone } from '../shared/time';
import { validateDisplayUnits, type DisplayUnits } from '../shared/units';
import { STATION_ID, type DB } from './db';

interface StationRow {
  name: string;
  time_zone: string;
  display_units: string;
  retention_days: number;
  current_profile_id: number | null;
  setup_complete: number;
}

interface ProfileRow {
  id: number;
  version: number;
  settings_json: string;
  created_at: number;
}

const profileCache = new Map<number, InputProfile>();

function toProfile(row: ProfileRow): InputProfile {
  return { ...(JSON.parse(row.settings_json) as ProfileSettings), id: row.id, version: row.version, createdAt: new Date(row.created_at).toISOString() };
}

/** Profiles are immutable, so caching by id is safe. */
export function getProfile(db: DB, id: number): InputProfile | null {
  const hit = profileCache.get(id);
  if (hit) return hit;
  const row = db.prepare('SELECT id, version, settings_json, created_at FROM input_profile WHERE id = ? AND station_id = ?').get(id, STATION_ID) as ProfileRow | undefined;
  if (!row) return null;
  const p = toProfile(row);
  profileCache.set(id, p);
  return p;
}

export function clearProfileCache() {
  profileCache.clear();
}

export function getStation(db: DB): StationSettings & { currentProfileId: number | null } {
  const r = db.prepare('SELECT * FROM station WHERE id = ?').get(STATION_ID) as StationRow;
  return {
    name: r.name,
    timeZone: r.time_zone,
    retentionDays: r.retention_days,
    displayUnits: JSON.parse(r.display_units) as DisplayUnits,
    setupComplete: r.setup_complete === 1,
    currentProfileId: r.current_profile_id,
  };
}

export function getSettings(db: DB): SettingsResponse {
  const { currentProfileId, ...station } = getStation(db);
  return { station, profile: currentProfileId ? getProfile(db, currentProfileId) : null };
}

export class SettingsError extends Error {
  constructor(public errors: string[]) {
    super(errors.join('; '));
  }
}

export function updateSettings(db: DB, body: unknown): SettingsResponse {
  const b = (body ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const s = (b.station ?? {}) as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  if (s.name !== undefined) {
    if (typeof s.name !== 'string' || s.name.trim().length < 1 || s.name.trim().length > 80) errors.push('Station name must be 1–80 characters');
    else updates.name = s.name.trim();
  }
  if (s.timeZone !== undefined) {
    if (!isValidTimeZone(s.timeZone)) errors.push('Time zone must be a valid IANA zone, e.g. America/Chicago');
    else updates.time_zone = s.timeZone;
  }
  if (s.retentionDays !== undefined) {
    if (!Number.isInteger(s.retentionDays) || (s.retentionDays as number) < 1 || (s.retentionDays as number) > 3650) errors.push('Retention must be 1–3650 days');
    else updates.retention_days = s.retentionDays;
  }
  if (s.displayUnits !== undefined) {
    const d = validateDisplayUnits(s.displayUnits);
    if (!d) errors.push('Display units are invalid');
    else updates.display_units = JSON.stringify(d);
  }
  let profile: ProfileSettings | null = null;
  if (b.profile !== undefined) {
    const v = validateProfileSettings(b.profile);
    if (!v.ok) errors.push(...v.errors);
    else profile = pickProfileSettings(v.value);
  }
  if (s.setupComplete !== undefined && typeof s.setupComplete !== 'boolean') errors.push('setupComplete must be true or false');
  if (errors.length) throw new SettingsError(errors);

  db.transaction(() => {
    const current = getStation(db);
    if (profile) {
      const existing = current.currentProfileId ? getProfile(db, current.currentProfileId) : null;
      if (!existing || !sameInterpretation(existing, profile)) {
        const version = ((db.prepare('SELECT MAX(version) v FROM input_profile WHERE station_id = ?').get(STATION_ID) as { v: number | null }).v ?? 0) + 1;
        const id = db.prepare('INSERT INTO input_profile (station_id, version, settings_json, created_at) VALUES (?, ?, ?, ?)')
          .run(STATION_ID, version, JSON.stringify(profile), Date.now()).lastInsertRowid as number;
        updates.current_profile_id = id;
      }
    }
    if (s.setupComplete === true) {
      const hasProfile = updates.current_profile_id ?? current.currentProfileId;
      if (!hasProfile) throw new SettingsError(['Confirm the instrument output profile before finishing setup']);
      updates.setup_complete = 1;
    }
    const keys = Object.keys(updates);
    if (keys.length) {
      db.prepare(`UPDATE station SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @now WHERE id = @id`)
        .run({ ...updates, now: Date.now(), id: STATION_ID });
    }
  })();
  return getSettings(db);
}
