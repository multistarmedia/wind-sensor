import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { readConfig, type Config } from '../server/config';
import { openDb, type DB } from '../server/db';
import { csvNumber, csvText } from '../server/export';
import { runRetention } from '../server/retention';
import { clearProfileCache } from '../server/settings';
import { withChecksum } from '../shared/parser';
import { SUGGESTED_PROFILE } from '../shared/profile';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'correct horse battery staple';
const LINE = '000.6,272,+023.6,022,0974.3,000.00,0000,12.7,U0,*02355';

let dir: string;
let config: Config;
let db: DB;

function makeApp() {
  return createApp(config, db);
}

async function login(app = makeApp()) {
  const agent = request.agent(app);
  const res = await agent.post('/api/login').set('Origin', ORIGIN).send({ password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, csrf: res.body.csrfToken as string };
}

async function setup(agent: request.Agent, csrf: string, profile = {}) {
  const res = await agent.put('/api/settings').set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send({
    station: { name: 'Test', timeZone: 'America/Chicago', setupComplete: true },
    profile: { ...SUGGESTED_PROFILE, unitsConfirmed: true, ...profile },
  });
  expect(res.status).toBe(200);
  return res.body.profile.id as number;
}

function record(raw = LINE, at = new Date(Date.now() - 1000)) {
  return { id: crypto.randomUUID(), sequence: 1, observedAt: at.toISOString(), raw };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aio2-'));
  config = readConfig({
    PUBLIC_ORIGIN: ORIGIN,
    OWNER_PASSWORD: PASSWORD,
    SESSION_SECRET: 'x'.repeat(40),
    DATA_DIR: dir,
  });
  clearProfileCache();
  db = openDb(config.dbPath, { retentionDays: 90 });
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('configuration', () => {
  it('refuses to start without a credential or with a weak secret', () => {
    expect(() => readConfig({ PUBLIC_ORIGIN: ORIGIN, SESSION_SECRET: 'x'.repeat(40) })).toThrow(/OWNER_PASSWORD/);
    expect(() => readConfig({ PUBLIC_ORIGIN: ORIGIN, OWNER_PASSWORD: PASSWORD, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => readConfig({ PUBLIC_ORIGIN: 'http://example.com', OWNER_PASSWORD: PASSWORD, SESSION_SECRET: 'x'.repeat(40) })).toThrow(/https/);
  });
});

describe('security (acceptance 20)', () => {
  it('rejects unauthenticated data access', async () => {
    const app = makeApp();
    for (const p of ['/api/status', '/api/settings', '/api/history', '/api/export.csv', '/api/log', '/api/diagnostics']) {
      expect((await request(app).get(p)).status).toBe(401);
    }
  });

  it('rejects a wrong password and rate-limits repeated attempts', async () => {
    const app = makeApp();
    for (let i = 0; i < 10; i++) {
      expect((await request(app).post('/api/login').set('Origin', ORIGIN).send({ password: 'nope' })).status).toBe(401);
    }
    expect((await request(app).post('/api/login').set('Origin', ORIGIN).send({ password: PASSWORD })).status).toBe(429);
  });

  it('rejects mutations without the CSRF token or from another origin', async () => {
    const { agent, csrf } = await login();
    expect((await agent.put('/api/settings').set('Origin', ORIGIN).send({ station: { name: 'x' } })).status).toBe(403);
    expect((await agent.put('/api/settings').set('Origin', 'https://evil.example').set('X-CSRF-Token', csrf).send({ station: { name: 'x' } })).status).toBe(403);
    expect((await agent.put('/api/settings').set('X-CSRF-Token', csrf).send({ station: { name: 'x' } })).status).toBe(403);
  });

  it('rejects invalid and oversized date ranges', async () => {
    const { agent } = await login();
    expect((await agent.get('/api/history?from=garbage')).status).toBe(400);
    expect((await agent.get('/api/history?from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z')).status).toBe(400);
    expect((await agent.get('/api/history?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z')).status).toBe(400);
  });

  it('rejects oversized uploads', async () => {
    const { agent, csrf } = await login();
    const profileId = await setup(agent, csrf);
    const records = Array.from({ length: 101 }, () => record());
    const res = await agent.post('/api/observations/batch').set('Origin', ORIGIN).set('X-CSRF-Token', csrf)
      .send({ captureSessionId: crypto.randomUUID(), profileId, records });
    expect(res.status).toBe(413);
    const huge = await agent.post('/api/observations/batch').set('Origin', ORIGIN).set('X-CSRF-Token', csrf)
      .set('Content-Type', 'application/json').send(JSON.stringify({ pad: 'x'.repeat(400_000) }));
    expect(huge.status).toBe(413);
  });

  it('does not serve private files and sets serial permissions', async () => {
    const res = await request(makeApp()).get('/healthz');
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['permissions-policy']).toContain('serial=(self)');
    expect(res.headers['x-frame-options']).toBe('DENY');
    for (const p of ['/.env', '/data/aio2.sqlite', '/server/app.ts', '/package.json']) {
      const r = await request(makeApp()).get(p);
      expect(r.text).not.toContain('SESSION_SECRET');
      expect(r.text).not.toContain('SQLite format');
    }
  });
});

describe('ingest', () => {
  it('stores valid records, reports duplicates on retry, and rejects bad lines with reasons (acceptance 13)', async () => {
    const { agent, csrf } = await login();
    const profileId = await setup(agent, csrf);
    const session = crypto.randomUUID();
    const good = record();
    const bad = record('000.6,272,+023.6,022,0974.3,000.00,0000,12.7,U0,*02257');
    const send = () => agent.post('/api/observations/batch').set('Origin', ORIGIN).set('X-CSRF-Token', csrf)
      .send({ captureSessionId: session, profileId, records: [good, bad] });

    const first = await send();
    expect(first.status).toBe(200);
    expect(first.body.accepted).toEqual([good.id]);
    expect(first.body.rejected).toEqual([{ id: bad.id, code: 'checksum_mismatch', message: expect.stringContaining('2355') }]);

    // Response "lost" after commit: the client retries the same ids.
    const retry = await send();
    expect(retry.body.accepted).toEqual([]);
    expect(retry.body.duplicates).toEqual([good.id]);
    expect((db.prepare('SELECT COUNT(*) n FROM observation').get() as { n: number }).n).toBe(1);
  });

  it('keeps identical successive measurements as separate observations', async () => {
    const { agent, csrf } = await login();
    const profileId = await setup(agent, csrf);
    const records = [record(), record(), record()];
    const res = await agent.post('/api/observations/batch').set('Origin', ORIGIN).set('X-CSRF-Token', csrf)
      .send({ captureSessionId: crypto.randomUUID(), profileId, records });
    expect(res.body.accepted).toHaveLength(3);
  });

  it('distinguishes layout, timestamp and missing-profile failures', async () => {
    const { agent, csrf } = await login();
    const profileId = await setup(agent, csrf);
    const post = (body: object) => agent.post('/api/observations/batch').set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(body);
    const noBv = record(withChecksum('000.0,000,+024.5,045,0970.5,000.00,0000,M0,'));
    const future = record(LINE, new Date(Date.now() + 3600_000));
    const r = await post({ captureSessionId: crypto.randomUUID(), profileId, records: [noBv, future] });
    expect(r.body.rejected.map((x: { code: string }) => x.code)).toEqual(['wrong_layout', 'invalid_timestamp']);
    const missing = await post({ captureSessionId: crypto.randomUUID(), profileId: 999, records: [record()] });
    expect(missing.body.rejected[0].code).toBe('missing_profile');
  });

  it('interprets older records with their own profile after a profile change (acceptance 14)', async () => {
    const { agent, csrf } = await login();
    const v1 = await setup(agent, csrf);
    const v2 = await setup(agent, csrf, { windUnit: 'mph' });
    expect(v2).not.toBe(v1);
    const post = (profileId: number, raw: string) => agent.post('/api/observations/batch').set('Origin', ORIGIN).set('X-CSRF-Token', csrf)
      .send({ captureSessionId: crypto.randomUUID(), profileId, records: [record(raw)] });
    const line = withChecksum('010.0,090,+020.0,050,1000.0,000.00,0000,12.0,U0,');
    await post(v1, line); // queued before the change, still m/s
    await post(v2, line); // new session, mph
    const speeds = (db.prepare('SELECT profile_id, ws FROM observation ORDER BY profile_id').all() as { profile_id: number; ws: number }[]);
    expect(speeds[0]).toEqual({ profile_id: v1, ws: 10 });
    expect(speeds[1]!.ws).toBeCloseTo(4.4704, 4);
    // Saving identical settings does not create a new version.
    expect(await setup(agent, csrf, { windUnit: 'mph' })).toBe(v2);
  });
});

describe('summaries and history', () => {
  it('reports status, gaps in history, and wind rose counts', async () => {
    const { agent, csrf } = await login();
    const profileId = await setup(agent, csrf);
    const now = Date.now();
    const records = [
      record(withChecksum('005.0,359,+020.0,050,1000.0,000.00,0000,12.0,U0,'), new Date(now - 30_000)),
      record(withChecksum('005.0,001,+022.0,050,1000.0,000.00,0000,12.0,U0,'), new Date(now - 20_000)),
      record(withChecksum('000.1,180,+021.0,050,1000.0,000.00,0000,12.0,U0,'), new Date(now - 10_000)),
    ];
    await agent.post('/api/observations/batch').set('Origin', ORIGIN).set('X-CSRF-Token', csrf)
      .send({ captureSessionId: crypto.randomUUID(), profileId, records });

    const s = (await agent.get('/api/status')).body;
    expect(s.latest.m.windSpeedMs).toBeCloseTo(0.1);
    expect(s.last10min.samples).toBe(3);
    expect(s.last10min.peakSpeedMs).toBe(5);
    // Calm 180° reading is excluded; 359° and 1° average to north.
    expect(Math.min(s.last10min.meanDirDeg, 360 - s.last10min.meanDirDeg)).toBeLessThan(0.01);
    expect(s.today.tempHighC).toBe(22);
    expect(s.today.tempLowC).toBe(20);
    expect(s.capture.active).toBe(true);

    const h = (await agent.get(`/api/history?from=${new Date(now - 3600_000).toISOString()}&to=${new Date(now).toISOString()}`)).body;
    expect(h.points.length).toBeGreaterThan(600);
    expect(h.points.filter((p: { n: number }) => p.n > 0).length).toBeGreaterThan(0);
    expect(h.points[0].wsAvg).toBeNull(); // no data an hour ago => gap, not zero

    const rose = (await agent.get('/api/windrose')).body;
    expect(rose.total).toBe(3);
    expect(rose.calm).toBe(1);
    expect(rose.counts[0][2]).toBe(2); // north sector, Beaufort 3 (3.4–5.4 m/s)
  });
});

describe('CSV export (acceptance 19)', () => {
  it('quotes, neutralises formulas and keeps numbers typed', () => {
    expect(csvText('a,b')).toBe('"a,b"');
    expect(csvText('say "hi"')).toBe('"say ""hi"""');
    expect(csvText('line\nbreak')).toBe('"line\nbreak"');
    expect(csvText('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvText('+023.6,')).toBe(`"'+023.6,"`);
    expect(csvNumber(-12.5)).toBe('-12.5');
    expect(csvNumber(null)).toBe('');
  });

  it('streams a file with unit headers and empty missing values', async () => {
    const { agent, csrf } = await login();
    const profileId = await setup(agent, csrf);
    await agent.post('/api/observations/batch').set('Origin', ORIGIN).set('X-CSRF-Token', csrf)
      .send({ captureSessionId: crypto.randomUUID(), profileId, records: [record(withChecksum('000.6,272,-012.5,022,0974.3,000.00,0000,12.7,U0,'))] });
    const res = await agent.get('/api/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const [header, row] = res.text.trim().split('\r\n');
    expect(header).toContain('wind_speed_m_s');
    expect(header).toContain('air_temperature_c');
    const cols = row!.split(',');
    const idx = (name: string) => header!.split(',').indexOf(name);
    expect(cols[idx('air_temperature_c')]).toBe('-12.5');
    expect(cols[idx('rain_field_mm')]).toBe('');
    expect(cols[idx('wind_direction_reference')]).toBe('unconfirmed');
  });
});

describe('persistence (acceptance 17)', () => {
  it('keeps settings and history across a restart, and a backup restores them', async () => {
    const { agent, csrf } = await login();
    const profileId = await setup(agent, csrf);
    await agent.post('/api/observations/batch').set('Origin', ORIGIN).set('X-CSRF-Token', csrf)
      .send({ captureSessionId: crypto.randomUUID(), profileId, records: [record()] });

    const backupPath = path.join(dir, 'backup.sqlite');
    await db.backup(backupPath);
    db.close();

    clearProfileCache();
    db = openDb(config.dbPath, { retentionDays: 90 });
    const again = await login();
    const settings = (await again.agent.get('/api/settings')).body;
    expect(settings.station.name).toBe('Test');
    expect(settings.station.timeZone).toBe('America/Chicago');
    expect((await again.agent.get('/api/status')).body.latest).not.toBeNull();

    const restored = new Database(backupPath, { readonly: true });
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
    expect((restored.prepare('SELECT COUNT(*) n FROM observation').get() as { n: number }).n).toBe(1);
    restored.close();
  });

  it('retention removes only expired observations', async () => {
    const { agent, csrf } = await login();
    const profileId = await setup(agent, csrf);
    await agent.post('/api/observations/batch').set('Origin', ORIGIN).set('X-CSRF-Token', csrf)
      .send({ captureSessionId: crypto.randomUUID(), profileId, records: [record()] });
    expect(await runRetention(db)).toBe(0);
    expect(await runRetention(db, Date.now() + 91 * 86_400_000)).toBe(1);
  });
});
