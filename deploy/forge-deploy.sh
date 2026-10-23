#!/usr/bin/env bash
# Build and (re)start the AIO 2 Weather Console. Called from the Forge deploy script, from the
# directory containing the freshly checked-out code (the site root, or the new release directory
# with zero-downtime deployments).
#
# The Node process itself is kept alive by a Forge daemon (supervisor). This script stops the old
# process through its pid file; supervisor starts it again with the new code.
#
#   bash deploy/forge-deploy.sh          build, migrate, restart (classic deployments)
#   bash deploy/forge-deploy.sh build    build and migrate only (zero-downtime: before $ACTIVATE_RELEASE())
#   bash deploy/forge-deploy.sh restart  restart and health-check only (zero-downtime: after $ACTIVATE_RELEASE())
set -euo pipefail

PHASE="${1:-all}"
APP_DIR="$(pwd)"
echo "==> AIO 2 Weather Console: ${PHASE} in ${APP_DIR}"

# --- Node version ---------------------------------------------------------------------------------
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 22 ]; then
  echo "Node 22 or newer is required (found $(node -v)). Install Node 24 LTS on the server." >&2
  exit 1
fi
echo "    node $(node -v), npm $(npm -v)"

# --- Configuration --------------------------------------------------------------------------------
if [ ! -f .env ]; then
  echo "No .env found in ${APP_DIR}. Add the environment in Forge (Site → Environment) first." >&2
  exit 1
fi
env_value() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//"; }
DATA_DIR="$(env_value DATA_DIR)"
DATA_DIR="${DATA_DIR:-${APP_DIR}/data}"
case "${DATA_DIR}" in
  "${APP_DIR}"*) echo "    WARNING: DATA_DIR is inside the code directory; use a path outside it (e.g. /home/forge/wind-sensor-data)." ;;
esac
mkdir -p "${DATA_DIR}/backups"
chmod 700 "${DATA_DIR}"

if [ "${PHASE}" != "restart" ]; then
# --- Build ----------------------------------------------------------------------------------------
echo "==> Installing dependencies"
npm ci --no-audit --no-fund
echo "==> Building"
npm run build
echo "==> Running tests"
npm test
npm prune --omit=dev --no-audit --no-fund

# --- Database -------------------------------------------------------------------------------------
if [ -f "${DATA_DIR}/aio2.sqlite" ]; then
  echo "==> Backing up the database before migrating"
  npm run --silent backup -- "${DATA_DIR}/backups/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
  # Keep the 10 most recent pre-deploy backups.
  ls -1t "${DATA_DIR}"/backups/pre-deploy-*.sqlite 2>/dev/null | tail -n +11 | xargs -r rm -f
fi
echo "==> Migrating"
npm run --silent migrate
fi
[ "${PHASE}" = "build" ] && exit 0

# --- Restart --------------------------------------------------------------------------------------
PID_FILE="${DATA_DIR}/server.pid"
if [ -f "${PID_FILE}" ] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
  echo "==> Restarting (supervisor brings the daemon back with the new build)"
  kill -TERM "$(cat "${PID_FILE}")"
else
  echo "==> No running server found. Make sure the Forge daemon exists (see README → Forge setup)."
fi

# --- Health check ---------------------------------------------------------------------------------
PORT="$(env_value PORT)"
PORT="${PORT:-3000}"
for i in $(seq 1 20); do
  sleep 1
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    echo "==> Healthy on port ${PORT}"
    exit 0
  fi
done
echo "Server did not answer on http://127.0.0.1:${PORT}/healthz within 20 s. Check the daemon log in Forge." >&2
exit 1
