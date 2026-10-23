import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_DISPLAY_UNITS } from '../shared/units';

export type DB = Database.Database;

export const STATION_ID = 1;

// Append-only. Each entry runs once, tracked by PRAGMA user_version.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE station (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    display_units TEXT NOT NULL,
    retention_days INTEGER NOT NULL,
    current_profile_id INTEGER REFERENCES input_profile(id),
    setup_complete INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE input_profile (
    id INTEGER PRIMARY KEY,
    station_id INTEGER NOT NULL REFERENCES station(id),
    version INTEGER NOT NULL,
    settings_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (station_id, version)
  );

  CREATE TABLE capture_session (
    id TEXT PRIMARY KEY,
    station_id INTEGER NOT NULL REFERENCES station(id),
    profile_id INTEGER NOT NULL REFERENCES input_profile(id),
    source_type TEXT NOT NULL,
    user_agent TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    last_heartbeat_at INTEGER NOT NULL
  );
  CREATE INDEX capture_session_heartbeat ON capture_session (station_id, last_heartbeat_at);

  CREATE TABLE observation (
    id TEXT NOT NULL UNIQUE,
    station_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    profile_id INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    observed_at INTEGER NOT NULL,
    server_received_at INTEGER NOT NULL,
    ws REAL NOT NULL,
    wd REAL NOT NULL,
    at REAL NOT NULL,
    rh REAL NOT NULL,
    bp REAL NOT NULL,
    rain REAL,
    solar REAL,
    bv REAL,
    compass REAL,
    config TEXT,
    raw TEXT NOT NULL,
    quality_flags TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX observation_time ON observation (station_id, observed_at);

  CREATE TABLE diagnostic_event (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    station_id INTEGER NOT NULL,
    session_id TEXT,
    code TEXT NOT NULL,
    message TEXT NOT NULL,
    sample TEXT
  );

  CREATE TABLE auth_session (
    token_hash TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
];

export function openDb(dbPath: string, defaults: { retentionDays: number }): DB {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  ensureStation(db, defaults.retentionDays);
  return db;
}

export function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

function ensureStation(db: DB, retentionDays: number) {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO station (id, name, time_zone, display_units, retention_days, setup_complete, created_at, updated_at)
     VALUES (?, 'Weather station', 'UTC', ?, ?, 0, ?, ?)`,
  ).run(STATION_ID, JSON.stringify(DEFAULT_DISPLAY_UNITS), retentionDays, now, now);
}
