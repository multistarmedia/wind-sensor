import fs from 'node:fs';
import path from 'node:path';

export interface Config {
  host: string;
  port: number;
  publicOrigin: string;
  secureCookies: boolean;
  ownerPassword: string | null;
  ownerPasswordHash: string | null;
  sessionSecret: string;
  dataDir: string;
  dbPath: string;
  retentionDays: number;
  trustProxy: string;
  clientDir: string;
}

const PLACEHOLDERS = new Set(['change-me', 'changeme', 'password', 'replace-me']);

export class ConfigError extends Error {}

/** Load `.env` from the working directory if present (Forge writes one in the site root). */
export function loadDotEnv(file = path.resolve('.env')) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const errors: string[] = [];
  const publicOrigin = (env.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(publicOrigin)) errors.push('PUBLIC_ORIGIN must be an origin such as https://wind-sensor.example.com');
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicOrigin);
  if (publicOrigin.startsWith('http:') && !isLocal) errors.push('PUBLIC_ORIGIN must use https unless it is localhost');

  const ownerPassword = env.OWNER_PASSWORD?.length ? env.OWNER_PASSWORD : null;
  const ownerPasswordHash = env.OWNER_PASSWORD_HASH?.length ? env.OWNER_PASSWORD_HASH : null;
  if (!ownerPassword && !ownerPasswordHash) errors.push('Set OWNER_PASSWORD_HASH (npm run hash-password) or OWNER_PASSWORD');
  if (ownerPassword && (ownerPassword.length < 12 || PLACEHOLDERS.has(ownerPassword.toLowerCase()))) {
    errors.push('OWNER_PASSWORD must be at least 12 characters and not a placeholder');
  }
  if (ownerPasswordHash && !ownerPasswordHash.startsWith('scrypt$')) errors.push('OWNER_PASSWORD_HASH must come from npm run hash-password');

  const sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32 || PLACEHOLDERS.has(sessionSecret.toLowerCase())) {
    errors.push('SESSION_SECRET must be at least 32 random characters (openssl rand -hex 32)');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT must be 1–65535');
  const retentionDays = Number(env.RETENTION_DAYS ?? 90);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) errors.push('RETENTION_DAYS must be 1–3650');

  if (errors.length) throw new ConfigError(`Configuration problems:\n - ${errors.join('\n - ')}`);

  const dataDir = path.resolve(env.DATA_DIR ?? './data');
  return {
    host: env.HOST ?? '127.0.0.1',
    port,
    publicOrigin,
    secureCookies: publicOrigin.startsWith('https:'),
    ownerPassword,
    ownerPasswordHash,
    sessionSecret,
    dataDir,
    dbPath: path.join(dataDir, 'aio2.sqlite'),
    retentionDays,
    trustProxy: env.TRUST_PROXY ?? 'loopback',
    clientDir: path.resolve(env.CLIENT_DIR ?? './dist/client'),
  };
}
