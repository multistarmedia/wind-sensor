import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Config } from './config';
import type { DB } from './db';

const SESSION_TTL_MS = 30 * 24 * 3600_000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

// ---- Password hashing (scrypt) ----

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

/** Resolve the owner credential once at startup: a plain OWNER_PASSWORD is hashed in memory. */
export function ownerCredential(config: Config): string {
  return config.ownerPasswordHash ?? hashPassword(config.ownerPassword!);
}

// ---- Login rate limiting (per client IP plus a global ceiling) ----

const WINDOW_MS = 15 * 60_000;

export class LoginLimiter {
  private perIp = new Map<string, { count: number; resetAt: number }>();
  private global = { count: 0, resetAt: 0 };
  constructor(private maxPerIp = 10, private maxGlobal = 100) {}

  /** Returns seconds to wait, or 0 if the attempt may proceed. */
  check(ip: string, now = Date.now()): number {
    if (now > this.global.resetAt) this.global = { count: 0, resetAt: now + WINDOW_MS };
    let e = this.perIp.get(ip);
    if (!e || now > e.resetAt) {
      e = { count: 0, resetAt: now + WINDOW_MS };
      this.perIp.set(ip, e);
    }
    if (e.count >= this.maxPerIp) return Math.ceil((e.resetAt - now) / 1000);
    if (this.global.count >= this.maxGlobal) return Math.ceil((this.global.resetAt - now) / 1000);
    e.count++;
    this.global.count++;
    if (this.perIp.size > 10_000) this.perIp.clear();
    return 0;
  }

  succeeded(ip: string) {
    this.perIp.delete(ip);
  }
}

// ---- Sessions ----

export const COOKIE_SECURE = '__Host-aio2_session';
export const COOKIE_DEV = 'aio2_session';

export interface AuthSession {
  csrfToken: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthSession;
  }
}

export class Sessions {
  constructor(private db: DB, private config: Config) {}

  get cookieName() {
    return this.config.secureCookies ? COOKIE_SECURE : COOKIE_DEV;
  }

  private tokenHash(token: string) {
    return crypto.createHmac('sha256', this.config.sessionSecret).update(token).digest('hex');
  }

  create(res: Response): AuthSession {
    const token = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    this.db
      .prepare('INSERT INTO auth_session (token_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(this.tokenHash(token), csrfToken, now, now + SESSION_TTL_MS);
    res.cookie(this.cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.secureCookies,
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
    return { csrfToken };
  }

  read(req: Request): AuthSession | null {
    const token = parseCookies(req.headers.cookie)[this.cookieName];
    if (!token) return null;
    const row = this.db
      .prepare('SELECT csrf_token, expires_at FROM auth_session WHERE token_hash = ?')
      .get(this.tokenHash(token)) as { csrf_token: string; expires_at: number } | undefined;
    if (!row || row.expires_at < Date.now()) return null;
    return { csrfToken: row.csrf_token };
  }

  destroy(req: Request, res: Response) {
    const token = parseCookies(req.headers.cookie)[this.cookieName];
    if (token) this.db.prepare('DELETE FROM auth_session WHERE token_hash = ?').run(this.tokenHash(token));
    res.clearCookie(this.cookieName, { path: '/', secure: this.config.secureCookies, sameSite: 'lax', httpOnly: true });
  }

  purgeExpired() {
    this.db.prepare('DELETE FROM auth_session WHERE expires_at < ?').run(Date.now());
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // ignore malformed cookie values
    }
  }
  return out;
}

// ---- Middleware ----

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Reject cross-origin mutations. Browsers always send Origin on POST/PUT/DELETE fetches. */
export function requireSameOrigin(config: Config) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin !== config.publicOrigin) {
      return res.status(403).json({ code: 'bad_origin', message: 'Request origin is not allowed' });
    }
    next();
  };
}

export function requireAuth(sessions: Sessions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const s = sessions.read(req);
    if (!s) return res.status(401).json({ code: 'unauthenticated', message: 'Sign in required' });
    if (!SAFE_METHODS.has(req.method)) {
      const sent = req.headers['x-csrf-token'];
      if (typeof sent !== 'string' || !safeEqual(sent, s.csrfToken)) {
        return res.status(403).json({ code: 'bad_csrf', message: 'Missing or invalid CSRF token; reload the page' });
      }
    }
    req.auth = s;
    next();
  };
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
