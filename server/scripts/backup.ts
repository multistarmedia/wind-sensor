// Online, consistent SQLite backup (safe while the server is running), then an integrity check of the copy.
//   npm run backup                 -> $DATA_DIR/backups/aio2-<timestamp>.sqlite
//   npm run backup -- /path/file   -> that file
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadDotEnv } from '../config';

loadDotEnv();
const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const source = path.join(dataDir, 'aio2.sqlite');
if (!fs.existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.resolve(process.argv[2] ?? path.join(dataDir, 'backups', `aio2-${stamp}.sqlite`));
fs.mkdirSync(path.dirname(target), { recursive: true });

const db = new Database(source, { readonly: true, fileMustExist: true });
await db.backup(target);
db.close();

// Make the copy a single self-contained file (no -wal/-shm), then verify it.
const copy = new Database(target);
copy.pragma('journal_mode = DELETE');
const check = copy.pragma('integrity_check', { simple: true });
const rows = (copy.prepare('SELECT COUNT(*) n FROM observation').get() as { n: number }).n;
copy.close();
if (check !== 'ok') {
  console.error(`Backup written to ${target} but integrity_check returned: ${check}`);
  process.exit(1);
}
console.log(`Backup OK: ${target} (${rows} observations, ${(fs.statSync(target).size / 1e6).toFixed(1)} MB)`);
