// Apply database migrations without starting the server (run by the deploy script).
import { loadDotEnv } from '../config';
import { openDb } from '../db';
import path from 'node:path';

loadDotEnv();
const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const dbPath = path.join(dataDir, 'aio2.sqlite');
const db = openDb(dbPath, { retentionDays: Number(process.env.RETENTION_DAYS ?? 90) });
console.log(`Migrated ${dbPath} to schema version ${db.pragma('user_version', { simple: true })}`);
db.close();
