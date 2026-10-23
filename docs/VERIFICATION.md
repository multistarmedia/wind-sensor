# Verification status

## Verified (simulated / automated, not on hardware)

`npm test` runs 46 automated tests. They cover:

- **Framing:** lines split across arbitrary chunks, several lines per chunk, split CR/LF, blank lines, and oversized-line recovery (no duplicates, bounded buffer).
- **Checksum:** the calculated `*02355` fixture passes; the manual's printed `*02257` fails under the stated rule; legacy whitespace is preserved.
- **Layouts:** voltage on/off, compass on, legacy; mismatches are rejected with explicit errors.
- **Values:** empty fields never become zero.
- **Units:** imperial input normalises to canonical units; rain/solar stay null when not installed; display units never touch storage.
- **Direction:** 359° and 1° average to north; cancelling vectors report unavailable.
- **Time:** "today" boundaries across US DST changes and a zone where DST skips midnight.
- **Server security:** auth, rate limiting, CSRF/origin checks, range validation, oversized bodies, no private files served.
- **Server ingest:** idempotent retries, profile versioning, history gaps, wind rose, CSV quoting and formula neutralisation, restart persistence, backup integrity, retention.
- **Browser queue:** outage then recovery uploads each record exactly once with the original ids and timestamps; a lost response is retried without duplicates; session expiry keeps records and pauses; a quota failure is reported; server rejections are quarantined.
- **Demo:** produces only valid, fragmented records and never touches the real queue.

Checked manually in Chrome against a local production build:

- sign-in;
- setup wizard;
- demo dashboard (animated rose, needle and trail);
- connection diagnostics;
- history (gaps visible);
- log;
- CSV export;
- stale state.

The deploy script was run end to end against a simulated supervisor: build, tests, pre-deploy backup, migrate, restart, health check.

## Not yet verified: needs a real AIO 2

1. **Checksum behaviour on real output.** None of the example lines in the manual (Rev D page 16, or the Rev G appendix BV/CV examples) match the checksum rule the manual states. If real lines are all rejected with "checksum mismatch", capture one line from the Connection page and compare it before changing anything. Validation must not simply be switched off.
2. **Field layout with BV/CV toggles.** The compass field position (after BV, before CONFIG) is taken from the Rev G CV1 example. Layout with BV0 + CV1 is assumed by analogy.
3. **Units.** The CONFIG marker (U0/M0) is treated as opaque. The owner must confirm SU/TU/PU/RU settings.
4. **Rain field semantics.** Rain is shown only as the raw field; no totals or rates are computed. Modbus documents "reset on read", but serial-output behaviour is unknown.
5. **Real Web Serial session.** The port chooser, unplug handling, and a busy port were exercised only through code paths and the simulator, not a physical COM2 port.
6. **Forge daemon paths.** Classic vs zero-downtime directory layout depends on how the Forge site was created.

## Operational limits

- Capture needs the source browser tab open and the PC awake. There is no background collection.
- One station and one shared owner password per deployment.
- History and export: up to 31 days per request. History is aggregated to about 700–750 points.
- Wind speed accepted up to 80.5 m/s (180 mph, the owner's stated ceiling). The instrument's documented operating range is 0–75 m/s.
- "Peak reading" is the highest single 1-second reading, not a standards-defined gust.
- Pressure is station pressure; no sea-level correction.
- Calm threshold: below 0.3 m/s (Beaufort force 0), the needle is hidden and "Calm" is shown.
- Averages are sample-weighted (the instrument outputs at a fixed interval).
- Mean direction is a unit-vector mean that excludes calm samples. It is undefined when the resultant length is below 0.05.
