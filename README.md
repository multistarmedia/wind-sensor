# AIO 2 Weather Console

A live dashboard and logger for the **Met One AIO 2** all-in-one weather sensor.

The instrument's 1-second serial text stream becomes:

- an animated, Beaufort-coloured **wind rose** with a gliding needle and fading trail of recent readings;
- live temperature, humidity, pressure (and rain/solar/voltage when present) with trends;
- persistent **logging**, history charts, a searchable log, and **CSV export**.

It is viewable from any computer or phone.

**How it works.** The browser on the PC wired to the instrument reads the COM port directly (Web Serial, Chrome or Edge), checks every line, and uploads it. The web server never touches a serial port; it stores readings in SQLite and serves them to every signed-in viewer.

```
AIO 2 ──RS-232/USB──▶ PC (Chrome/Edge tab) ──HTTPS──▶ Node + SQLite ◀──HTTPS── phones / other PCs
```

- [Owner / server setup](#owner--server-setup)
- [End-user connection guide](#end-user-connection-guide)
- [Development](#development)
- [Backups and restore](#backups-and-restore)
- [What is verified, assumed, and limited](docs/VERIFICATION.md)

---

## Owner / server setup

Requirements:

- Node **22+** (24 LTS recommended).
- A persistent disk.
- HTTPS in front of the app (Web Serial requires a secure origin).

Serverless or ephemeral filesystems are **not** suitable for this SQLite design.

### Configuration (`.env`)

| Variable | Meaning |
| --- | --- |
| `HOST`, `PORT` | Where Node listens. Keep it on `127.0.0.1` behind the proxy. |
| `PUBLIC_ORIGIN` | Exact origin users open, e.g. `https://wind-sensor.on-forge.com`. Mutations from any other origin are rejected. |
| `OWNER_PASSWORD_HASH` | From `npm run hash-password` (keep the single quotes). Or set `OWNER_PASSWORD` (12+ chars) instead. |
| `SESSION_SECRET` | 32+ random characters (`openssl rand -hex 32`). |
| `DATA_DIR` | Persistent directory for the database and backups. **Keep it outside the code directory.** |
| `RETENTION_DAYS` | Initial retention (default 90). Changeable later in Settings. |
| `TRUST_PROXY` | `loopback` when nginx is on the same machine. |

The server refuses to start with missing or placeholder credentials. See `.env.example`.

### Laravel Forge (the current deployment)

1. **Environment.** Site → Environment: paste the `.env` contents (see `.env.example`).
2. **Nginx.** Site → Nginx: use `deploy/nginx-forge.conf`.
   - It proxies everything to `127.0.0.1:$PORT`.
   - Nothing from the repo is served from disk.
   - Keep the `proxy_pass` port equal to `PORT`.
   - To find free ports on the server: `ss -ltnp | grep node`.
3. **Daemon.** Server → Daemons → New:
   - **Command:** `node dist/server/index.mjs`
   - **Directory:**
     - classic deployments: the site directory, e.g. `/home/forge/wind-sensor.on-forge.com`;
     - zero-downtime deployments: its `current` symlink, e.g. `/home/forge/wind-sensor.on-forge.com/current`.
   - **User:** `forge`
   - **Processes:** `1`

   Supervisor keeps it running and restarts it after each deploy.
4. **Deploy script.** Site → Deployments → Deploy script.

   *Classic* (the site directory is a git checkout):
   ```bash
   cd $FORGE_SITE_PATH
   git pull origin $FORGE_SITE_BRANCH
   bash deploy/forge-deploy.sh
   ```

   *Zero-downtime* (Forge shows `$CREATE_RELEASE()` / `$ACTIVATE_RELEASE()`):
   ```bash
   $CREATE_RELEASE()
   cd $FORGE_RELEASE_DIRECTORY
   bash deploy/forge-deploy.sh build
   $ACTIVATE_RELEASE()
   cd $FORGE_SITE_PATH/current
   bash deploy/forge-deploy.sh restart
   ```

   `deploy/forge-deploy.sh` does the following, and fails the deploy if any step fails:
   - checks the Node version;
   - runs `npm ci`, builds, and runs the test suite;
   - backs up the database (keeps the last 10 pre-deploy backups);
   - migrates;
   - restarts the daemon through its pid file;
   - waits for `/healthz`.
5. **Enable auto-deploy** on the `main` branch. Every push to `main` then goes live.
6. **First use.** Open the site, sign in with the owner password, and follow setup:
   - station name and time zone;
   - instrument output settings, confirmed;
   - connect.

### Docker

```bash
cp .env.example .env    # fill in PUBLIC_ORIGIN, OWNER_PASSWORD_HASH, SESSION_SECRET
docker compose up -d --build
```

- The database lives in the `aio2-data` volume.
- Put `deploy/nginx-standalone.conf` (or any HTTPS proxy) in front of `127.0.0.1:3000`.

### Direct Node + systemd

```bash
npm ci && npm run build && npm test && npm prune --omit=dev
npm run migrate
sudo cp deploy/aio2-console.service /etc/systemd/system/
sudo systemctl enable --now aio2-console
```

### Storage

Measured: about **290 bytes per reading** including indexes. At 1 reading per second:

| Period | Readings | Disk |
| --- | --- | --- |
| Per day | ~86,400 | ~25 MB |
| 90 days (default retention) | ~7.8 million | ~2.2 GB |

Expired readings are deleted hourly, in small batches so live uploads are not blocked.

---

## End-user connection guide

You need:

- the AIO 2 wired to a Windows/Mac/Linux PC (built-in DB9 COM port or a USB-serial adapter);
- **Chrome or Microsoft Edge** on that PC.

Phones and other browsers can *view* readings but cannot read a serial port.

1. Close any other program using the port: Comet, PuTTY, HyperTerminal, a data logger. Only one program can hold a COM port.
2. Open the site's address in its own tab (not inside a preview frame) and sign in.
3. **Live → Connect instrument.** The browser shows its own list of serial ports. Pick the instrument's port, e.g. "Communications Port (COM2)" or "USB Serial Port (COM5)".
   - Not sure which one? Open **Device Manager → Ports (COM & LPT)**, unplug the adapter, and see which entry disappears.
4. The status shows **Connected — waiting for a valid reading**, then **Receiving**. The Connection page shows each raw line next to what it means.
5. Keep the tab open and the PC awake. Collection stops if the tab closes, you sign out, or the computer sleeps.
   - On the Connection page you can ask the browser to keep the screen awake. That helps but is not a guarantee.

Every other device just opens the same address and signs in to watch.

Settings are fixed at **9600 baud, 8 data bits, no parity, 1 stop bit, no flow control** (the AIO 2's documented defaults). The console only listens; it never sends commands to the instrument.

Status meanings:

| Status | Meaning |
| --- | --- |
| Disconnected | This browser is not reading the instrument |
| Waiting | Port open, no valid line yet |
| Receiving | Valid readings are arriving |
| Stale | No valid reading for over 10 s (or 3× the output interval) |
| Saving / Saved | Uploading / confirmed by the server |
| Offline — queued | Server unreachable; readings are kept in this browser and upload automatically |
| Recording paused | Browser storage full or signed out; readings are not being saved |
| Demo | Simulated data; nothing is saved |

Troubleshooting:

- **Strange characters or constant checksum errors:** wrong port or baud mismatch.
- **"Expected N fields":** the voltage/compass/format settings in Settings don't match the instrument.
- **Out-of-range values:** the units chosen in Settings don't match the instrument's SU/TU/PU settings.

---

## Development

```bash
npm install
cp .env.example .env      # set PUBLIC_ORIGIN=http://localhost:5173, OWNER_PASSWORD=..., SESSION_SECRET=..., DATA_DIR=./data
npm run dev               # Vite on :5173 (proxying /api to :3000) + API server with reload
npm test                  # parser, API, persistence, queue, simulator tests
npm run typecheck
npm run build && npm start
```

Use **Connection → Start demo** to drive the whole UI without hardware. The simulator can also:

- send a corrupted line;
- send an oversized line;
- pause;
- simulate an unplug.

Layout:

| Path | Contents |
| --- | --- |
| `shared/` | Record parser, checksum, line framer, profiles, units, wind maths. Used by browser and server. |
| `server/` | Express API, SQLite migrations, auth, ingest, aggregation, CSV export, retention, maintenance scripts. |
| `client/` | React + Polaris UI, Web Serial adapter, simulator, IndexedDB queue and uploader. |
| `deploy/` | Forge deploy script, nginx examples, systemd unit. |
| `docs/SPEC.md` | The build specification. |

API (all routes except login/session/healthz need a session; mutations need `X-CSRF-Token` and a same-origin `Origin`):

- `POST /api/login`, `POST /api/logout`, `GET /api/session`
- `GET|PUT /api/settings`
- `POST /api/capture-sessions`, `POST /api/capture-sessions/:id/end`
- `POST /api/observations/batch`
- `GET /api/status`, `/api/history`, `/api/windrose`, `/api/log`, `/api/diagnostics`, `/api/export.csv`
- `GET /healthz`

## Backups and restore

```bash
npm run backup                       # online, consistent copy → $DATA_DIR/backups/aio2-<time>.sqlite, then integrity check
npm run backup -- /path/backup.sqlite
```

The backup uses SQLite's online backup API, so it is safe while the server runs. **Copying the live `aio2.sqlite` file alone is not a valid backup** (recent writes live in the `-wal` file).

Restore:

1. Stop the daemon / service.
2. Run `npm run restore -- /path/backup.sqlite`. It checks the backup's integrity, moves the current database aside, and removes stale WAL files.
3. Start the daemon again.

Restore refuses to run while the server is up.

Off-site copies are up to you. For example, copy `$DATA_DIR/backups/` somewhere else on a schedule.

## Future option: background collector

The browser must stay open for collection. A small background collector could run as a Windows service on the sensor PC and post to the same batch API, so logging would survive a closed browser. It is not part of this version.
