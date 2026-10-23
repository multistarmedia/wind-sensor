# AIO 2 Weather Console

Web app that reads a Met One AIO 2 weather instrument over **browser Web Serial** on the user's PC, uploads validated records to a Node/SQLite backend, and shows a live dashboard, history, and CSV export.

**`docs/SPEC.md` is the source of truth.** Read the relevant section before implementing or changing a feature. If something here conflicts with the spec, the spec wins.

## Non-negotiables (easy to get wrong)

- The **browser** reads serial. The server never opens a serial/COM port and has no serial dependency.
- Never select a port by the string `COM2`. Ports come only from `navigator.serial.requestPort()` triggered by a user click.
- Serial is 9600 8N1, no flow control. No baud scanning. Passive reader: never write bytes to the instrument.
- Checksum: 16-bit sum of ASCII bytes from record start through the char before `*` (spaces and the trailing comma included), computed **before** trimming/splitting. `...U0,*02355` passes; the manual's printed `...U0,*02257` must fail.
- Empty field ≠ 0. Missing/uninstalled values are `null` and display as `—`.
- Never deduplicate by value or raw line. Idempotency is by observation UUID only.
- Wind direction = where wind comes **from**. Averages use vector math; cancelling vectors → unavailable.
- No invented data: no gust claims ("Peak reading" only), no sea-level pressure, no rain totals, no weather-condition labels, no battery %.
- Demo mode is fully isolated from real records, queues, and exports, and is always visibly labeled.
- Don't seed or display mock data outside demo mode / tests.

## Stack (pin versions, commit lockfile)

- Frontend: React + TypeScript + Vite, Polaris 12+, a maintained chart lib, IndexedDB upload queue.
- Backend: Node 24 LTS + TypeScript + Express, SQLite (WAL) with migrations and parameterized queries.
- Same-origin frontend + API behind HTTPS reverse proxy. No runtime CDNs or external fonts.

## Suggested layout

```
client/        React app (serial adapter, parser, queue, UI)
server/        Express API, migrations, aggregation, export
shared/        Record parser, checksum, profile types, unit conversion (used by both sides)
deploy/        Dockerfile, docker-compose.yml, nginx example, systemd unit
docs/SPEC.md   Specification
```

The parser/checksum lives in `shared/` so client and server validate identically (spec §5, §9).

## Build order

1. `shared/` parser, checksum, line framer, unit conversion + tests (acceptance tests 3–10).
2. Server: schema/migrations, auth/session/CSRF, batch ingest, status, history aggregation, export.
3. Client: serial adapter + simulator, IndexedDB queue/uploader, setup wizard, dashboard, history, diagnostics.
4. Deployment files, README (owner setup + end-user connection guide), verified/unverified list.

## Hardware status

No real AIO 2 record has been captured yet. All verification is simulated until one is. Report simulated results separately from hardware results (spec §15).
