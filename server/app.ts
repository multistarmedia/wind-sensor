import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { SessionResponse } from '../shared/api';
import { LoginLimiter, ownerCredential, requireAuth, requireSameOrigin, Sessions, verifyPassword } from './auth';
import type { Config } from './config';
import type { DB } from './db';
import { streamCsv } from './export';
import { endCaptureSession, ingestBatch, IngestError, isUuid, upsertCaptureSession } from './ingest';
import { diagnostics, history, log, parseRange, RangeError400, status, windRose } from './queries';
import { getSettings, getStation, SettingsError, updateSettings } from './settings';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function createApp(config: Config, db: DB) {
  const app = express();
  const sessions = new Sessions(db, config);
  const limiter = new LoginLimiter();
  const credential = ownerCredential(config);

  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Permissions-Policy', 'serial=(self), camera=(), microphone=(), geolocation=()');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.get('/healthz', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '256kb' }));
  api.use(requireSameOrigin(config));

  api.post('/login', (req, res) => {
    const wait = limiter.check(req.ip ?? 'unknown');
    if (wait) {
      res.setHeader('Retry-After', String(wait));
      return res.status(429).json({ code: 'rate_limited', message: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.` });
    }
    const password = (req.body as { password?: unknown })?.password;
    if (typeof password !== 'string' || password.length > 200 || !verifyPassword(password, credential)) {
      return res.status(401).json({ code: 'bad_password', message: 'That password is not correct' });
    }
    limiter.succeeded(req.ip ?? 'unknown');
    const s = sessions.create(res);
    res.json({ authenticated: true, csrfToken: s.csrfToken, serverTime: new Date().toISOString() } satisfies SessionResponse);
  });

  api.get('/session', (req, res) => {
    const s = sessions.read(req);
    res.json({ authenticated: !!s, csrfToken: s?.csrfToken ?? null, serverTime: new Date().toISOString() } satisfies SessionResponse);
  });

  api.post('/logout', (req, res) => {
    sessions.destroy(req, res);
    res.json({ ok: true });
  });

  api.use(requireAuth(sessions));

  api.get('/settings', (_req, res) => res.json(getSettings(db)));
  api.put('/settings', (req, res) => res.json(updateSettings(db, req.body)));

  api.post('/capture-sessions', (req, res) => {
    const b = (req.body ?? {}) as { id?: unknown; profileId?: unknown };
    if (!isUuid(b.id) || !Number.isInteger(b.profileId)) {
      return res.status(400).json({ code: 'invalid_request', message: 'id (UUID) and profileId are required' });
    }
    upsertCaptureSession(db, { id: b.id, profileId: b.profileId as number, sourceType: 'web_serial', userAgent: req.headers['user-agent'], startedAt: Date.now() });
    res.status(201).json({ id: b.id, profileId: b.profileId });
  });

  api.post('/capture-sessions/:id/end', (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ code: 'invalid_request', message: 'Invalid session id' });
    endCaptureSession(db, req.params.id);
    res.json({ ok: true });
  });

  api.post('/observations/batch', (req, res) => {
    const station = getStation(db);
    res.json(ingestBatch(db, req.body, { retentionDays: station.retentionDays, userAgent: req.headers['user-agent'] }));
  });

  api.get('/status', (_req, res) => res.json(status(db)));

  api.get('/history', (req, res) => {
    const { from, to } = parseRange(req.query);
    res.json(history(db, from, to));
  });

  api.get('/windrose', (req, res) => {
    const { from, to } = parseRange(req.query, Date.now(), 3600_000);
    res.json(windRose(db, from, to));
  });

  api.get('/log', (req, res) => res.json(log(db, req.query)));

  api.get('/diagnostics', (_req, res) => res.json(diagnostics(db)));

  api.get('/export.csv', async (req, res) => {
    const { from, to } = parseRange(req.query);
    const name = `aio2-observations-${new Date(from).toISOString().slice(0, 10)}-to-${new Date(to).toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    await streamCsv(db, res, from, to);
  });

  api.use((_req, res) => res.status(404).json({ code: 'not_found', message: 'Unknown API route' }));

  app.use('/api', api);

  // Built client only. Nothing else on disk is reachable.
  if (fs.existsSync(config.clientDir)) {
    app.use('/assets', express.static(path.join(config.clientDir, 'assets'), { immutable: true, maxAge: '1y', index: false, dotfiles: 'deny' }));
    app.use(express.static(config.clientDir, { index: false, dotfiles: 'deny', maxAge: 0 }));
    const indexHtml = path.join(config.clientDir, 'index.html');
    app.get('/{*path}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return res.end();
    if (err instanceof IngestError) return res.status(err.status).json({ code: err.code, message: err.message });
    if (err instanceof SettingsError) return res.status(422).json({ code: 'invalid_settings', message: err.message, errors: err.errors });
    if (err instanceof RangeError400) return res.status(400).json({ code: 'invalid_range', message: err.message });
    const e = err as { type?: string; status?: number; code?: string };
    if (e?.type === 'entity.too.large') return res.status(413).json({ code: 'request_too_large', message: 'Request body is too large' });
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ code: 'invalid_json', message: 'Request body is not valid JSON' });
    if (e?.code === 'SQLITE_BUSY') {
      res.setHeader('Retry-After', '2');
      return res.status(503).json({ code: 'temporary_failure', message: 'Database is busy; retry shortly' });
    }
    console.error(err);
    res.status(500).json({ code: 'server_error', message: 'Unexpected server error' });
  });

  return app;
}
