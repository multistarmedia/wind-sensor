// Restore a backup made by `npm run backup`. STOP THE SERVER FIRST.
//   npm run restore -- /path/to/aio2-backup.sqlite
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadDotEnv } from '../config';

loadDotEnv();
const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run restore -- /path/to/backup.sqlite   (stop the server first)');
  process.exit(1);
}
const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const target = path.join(dataDir, 'aio2.sqlite');

const src = new Database(path.resolve(file), { readonly: true, fileMustExist: true });
const check = src.pragma('integrity_check', { simple: true });
src.close();
if (check !== 'ok') {
  console.error(`Refusing to restore: integrity_check returned ${check}`);
  process.exit(1);
}

const pidFile = path.join(dataDir, 'server.pid');
if (fs.existsSync(pidFile)) {
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {
    // stale pid file
  }
  if (alive) {
    console.error(`The server is running (pid ${pid}). Stop it before restoring.`);
    process.exit(1);
  }
}

if (fs.existsSync(target)) {
  const aside = `${target}.before-restore-${Date.now()}`;
  fs.renameSync(target, aside);
  console.log(`Previous database moved to ${aside}`);
}
for (const ext of ['-wal', '-shm']) fs.rmSync(target + ext, { force: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.copyFileSync(path.resolve(file), target);
console.log(`Restored ${file} -> ${target}. Start the server again.`);
