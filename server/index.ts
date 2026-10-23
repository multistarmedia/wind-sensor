import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import { ConfigError, loadDotEnv, readConfig } from './config';
import { openDb } from './db';
import { scheduleRetention } from './retention';

loadDotEnv();

let config;
try {
  config = readConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

const db = openDb(config.dbPath, { retentionDays: config.retentionDays });
// Lets `npm run restore` refuse to run while the server is up.
const pidFile = path.join(config.dataDir, 'server.pid');
fs.writeFileSync(pidFile, String(process.pid));
process.on('exit', () => fs.rmSync(pidFile, { force: true }));
const stopRetention = scheduleRetention(db);
const app = createApp(config, db);
const server = app.listen(config.port, config.host, () => {
  console.log(`AIO 2 Weather Console listening on http://${config.host}:${config.port} (public origin ${config.publicOrigin})`);
  console.log(`Database: ${config.dbPath}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  stopRetention();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
