# AIO 2 Weather Console — Build Specification

Version 1.0 · October 23, 2026

## Instructions to the coding AI

Build a complete, production-ready web application from this specification. Deliver the entire source project, tests, deployment files, and a clear README. Implement the required version before optional enhancements. Make routine technical decisions independently, and document assumptions that require confirmation against real hardware.

The application will be uploaded to the owner's web server. The instrument belongs to an end user and is connected by serial to that end user's computer. **The user's browser must read the local serial device. The remote web server must never attempt to open the user's COM2 port.**

## 1. Product goal

Turn the Met One Instruments AIO 2 weather instrument's serial output into a readable home-weather-station experience: live wind readings, an understandable compass, supporting measurements, history, and downloadable logs.

The intended user can connect a serial instrument but should not need to interpret comma-separated records, configure a database, or run a terminal application to use the dashboard.

### Required scope

- One weather station and one password-protected owner account per deployment.
- Direct serial connection from a supported desktop browser.
- Live dashboard, persistent server logging, history charts, and CSV export.
- Guided connection setup, clear connection and recording status, and useful diagnostics.
- Responsive viewing from a second computer or phone while the source computer is collecting.
- A clearly identified demonstration mode that works without hardware and never contaminates real records.

### Outside the required version

- Multi-tenant accounts, billing, public station directories, or external weather services.
- Automatic instrument reconfiguration, arbitrary command transmission, firmware updates, SDI-12, Modbus, or polled operation.
- Guaranteed collection after the source browser closes or its computer sleeps.
- Automatic forecasts, storm predictions, or invented weather conditions.
- A background collector. Document this as a future option; do not require installation of a collector for the primary browser workflow.

## 2. Architecture and stack

Use this default stack unless a documented compatibility issue warrants a change:

| Layer | Choice |
| --- | --- |
| Frontend | React, TypeScript, and Vite |
| Components | Polaris 12 or later; choose a compatible React/Polaris dependency pair and pin versions |
| Charts | A maintained chart library compatible with the chosen React version |
| Device connection | Browser Web Serial API |
| Offline upload queue | IndexedDB |
| Backend | Node.js 24 LTS, TypeScript, Express |
| Persistent storage | SQLite on a persistent local volume, with WAL enabled |
| Hosting | One application origin behind an HTTPS reverse proxy |

Bundle frontend dependencies locally. No runtime CDN, paid API, external fonts, or external weather feed is required. Provide a production build and lockfile.

Data flow:

1. The instrument connects to the user's PC through its existing serial interface or a suitable adapter.
2. The user opens the hosted application's URL in a supported desktop browser on that PC.
3. A Connect button opens the browser's device chooser.
4. The browser reads complete records, validates them, displays readings, and queues uploads.
5. The backend independently validates records and writes them to SQLite.
6. Other authenticated browsers display the latest server-saved readings and history.

The web server only needs normal HTTP connectivity. It does not need a serial-port driver or a hardware connection to the instrument. A localhost deployment on the sensor computer must also work.

## 3. Browser and deployment prerequisites

- Target current desktop Chrome and Edge; detect actual Web Serial availability at runtime.
- Require HTTPS in hosted use. Permit HTTP localhost for development or local deployment.
- Open the application as a top-level page. Embedded previews are outside the supported acquisition path.
- Request port access from an explicit user click. Use the native chooser; do not promise that JavaScript can select a port by the Windows name `COM2`.
- Explain that the selected device should correspond to the instrument's port. Provide Windows Device Manager guidance if identification is ambiguous.
- Unsupported browsers may still view server history. Show an actionable explanation when local serial capture is unavailable.
- A phone can view readings already uploaded by the source PC. It cannot directly open that PC's COM2 port.

These are Web Serial platform constraints, separate from the application's own behavior. See the Chrome and MDN references at the end.

## 4. Instrument connection

The supplied AIO 2 manual page specifies this connection profile:

| Setting | Required default |
| --- | --- |
| Baud rate | 9600 |
| Data bits | 8 |
| Parity | None |
| Stop bits | 1 |
| Flow control | None |
| Normal output interval | One record per second |
| Framing | ASCII records terminated by carriage return and line feed |

Use 9600 as the documented setting. Do not treat “9600 to 19200” as a negotiable range or automatically scan baud rates. If an override is implemented, isolate it in Advanced Settings and require explicit confirmation that it matches the actual instrument.

Operate as a passive reader. Opening a port must not send terminal commands or modify the instrument's settings. Instrument configuration remains an external task in this version.

### Serial lifecycle

- Distinguish port permission, port open, incoming bytes, valid records, and saved records.
- Show “Connected — waiting for a valid reading” until a valid record arrives.
- Handle permission cancellation without presenting it as a device failure.
- Handle a port in use, unplugging, revoked permission, read failure, and manual disconnect.
- Cancel the reader, release stream locks, and close the port during disconnect.
- Maintain one capture owner per station/browser origin, using Web Locks or an equivalent mechanism. A second tab must not silently start another capture session.
- Reconnecting previously granted devices may be offered; do not repeatedly prompt without user interaction.
- State plainly that collection requires the browser and source PC to remain running and awake. A screen wake lock may help but is not a background-collection guarantee.

## 5. Record format and parsing

The supplied manual gives this standard field order:

```text
WS,WD,AT,RH,BP,RN,SR,BV,CONFIG,*CHECKSUM\r\n
```

| Field | Meaning | Storage treatment |
| --- | --- | --- |
| WS | Wind speed | Convert confirmed input units to m/s |
| WD | Wind direction | Degrees, normalized to 0–359.999… |
| AT | Ambient air temperature | Convert confirmed input units to °C |
| RH | Relative humidity | Percent |
| BP | Barometric pressure | Convert confirmed input units to hPa |
| RN | Rain measurement field | Optional; retain raw meaning and normalize units only |
| SR | Solar radiation | Optional; W/m² |
| BV | Supply voltage | Volts; optional output field |
| CONFIG | Configuration indicator | Preserve as an opaque string |
| CHECKSUM | Decimal checksum | Validate against original ASCII payload |

Use the uploaded manual page as the source for the above field mapping. Do not assume the configuration marker `U0` or `M0` alone establishes all measurement units.

The manufacturer's reference also describes optional compass output and legacy output. Support them through an explicit input profile, rather than guessing the meaning of an ambiguous field count.

### Input profile

Store a versioned, immutable interpretation profile containing:

- Format: standard or legacy.
- Whether the voltage and compass fields are included, where applicable.
- Input units for wind, temperature, pressure, and rain.
- Whether external rain and solar sensors are installed.
- Wind-direction reference: magnetic north, true north already configured on the instrument, or unconfirmed.
- Expected record interval for stale-data detection.
- An explicit confirmation that the user checked the instrument's output units.

Offer standard metric units as initial suggestions, but require confirmation before measurement ingestion. Unit labels must describe confirmed settings, not guessed settings. Changing a display preference must never reinterpret stored measurements.

A profile change creates a new profile version. Preserve old profiles for queued uploads and historical interpretation. Freeze the active profile for a capture session; require a deliberate disconnect/reconnect to change it.

### Stream handling

- Serial reads contain arbitrary byte chunks. A chunk is not necessarily a record.
- Buffer incomplete lines across reads and process every complete record in a chunk.
- Handle a CR/LF pair split across chunks; ignore empty terminators without creating duplicate records.
- Enforce a 512-byte record limit. If exceeded, report the failure, discard through the next delimiter, and recover cleanly.
- Reject non-ASCII or malformed input with a useful diagnostic.
- Calculate the checksum before trimming spaces or splitting fields. Spaces and commas can affect the calculation.
- Parse numeric fields explicitly; do not convert an empty field to zero.
- Validate field count against the selected profile, numeric finiteness, and documented or explicitly configured physical bounds.
- Reject invalid weather measurements from statistics. Preserve a bounded diagnostic sample of rejected records and the reason.
- Identical successive measurements are legitimate separate observations. Do not deduplicate by value or raw line.

### Checksum rule and a documentation discrepancy

Following the checksum description on the supplied manual page, add the ASCII byte values from the start of the record through the character immediately before `*`. Include intervening spaces and any comma immediately preceding `*`; exclude `*`, checksum digits, CR, and LF. Treat the result as a 16-bit sum and compare the decimal checksum numerically, allowing leading zeros.

The manual prints this illustrative record:

```text
000.6,272,+023.6,022,0974.3,000.00,0000,12.7,U0,*02257
```

The payload shown above sums to **2355**, not 2257, under that stated rule. Treat the printed line as a checksum-failure fixture. A synthetic fixture consistent with the rule is:

```text
000.6,272,+023.6,022,0974.3,000.00,0000,12.7,U0,*02355\r\n
```

This is a calculated test fixture, not a captured hardware measurement. Confirm checksum behavior against actual instrument output before claiming hardware verification. If real output disagrees, preserve raw bytes and investigate; do not silently disable validation to make the sample pass.

For legacy output, support the documented five-measurement layout:

```text
WS, WD, AT, RH, BP, *CHECKSUM\r\n
```

Preserve exact whitespace for checksum validation. Optional voltage/compass layout details should be checked against the matching firmware/manual; expose explicit layout controls and fail visibly on a mismatch.

## 6. Guided first-use experience

1. Sign in using the deployment's owner password.
2. Name the station and select its IANA time zone.
3. Confirm output format, units, optional fields, and installed accessories.
4. Show the documented connection settings and a Connect Instrument button.
5. Open the native port chooser and let the user select the device.
6. Display the first raw line and its interpreted values side by side.
7. Once the profile is confirmed and records validate, begin durable queuing and automatic server logging.

Avoid technical controls on the main dashboard. Keep raw output, field-layout options, and parsing errors in Connection/Diagnostics. Explain those settings there because they affect measurement interpretation.

## 7. Dashboard

Use a calm, readable layout with strong type hierarchy, generous spacing, and restrained animation. Use Polaris components for controls, forms, navigation, banners, and dialogs. A custom SVG compass and charts are appropriate for the weather displays.

### Live view

| Element | Required behavior |
| --- | --- |
| Primary wind card | Large speed, unit, compass, and text such as “Wind from W · 272°” |
| Wind context | Last 10-minute average and last 10-minute peak, with windows stated |
| Supporting cards | Temperature, humidity, pressure, and small recent trend charts |
| Optional cards | Rain field and solar reading when installed; otherwise “Not installed” or hidden |
| Daily context | Temperature high/low and peak wind for the station's calendar day |
| Connection strip | Capture status, server-saving status, last valid reading age, queue depth |
| Actions | Connect/Disconnect, display units, history, export, and settings |

Additional requirements:

- Treat direction as where wind comes from. Make the compass convention unambiguous.
- Keep magnetic versus true-north reference visible in the wind detail. Never claim true north when unconfirmed.
- At calm/near-calm wind, suppress a misleading animated direction and show “Calm”; make the threshold explicit in the implementation.
- Label simple maxima “Peak reading.” Do not call an instantaneous maximum a standards-compliant gust.
- Show unavailable values as an em dash or a clear unavailable state, never a fabricated zero.
- Display station pressure as measured. Do not label it sea-level pressure without an explicit, validated correction feature.
- Never infer rain accumulation, rain rate, or daily rainfall until the instrument's rain-field reset semantics are verified. The first version may show “Rain field” with explanatory help.
- Supply voltage is an instrument-health reading; do not invent a battery percentage.
- Do not display sunny/cloudy/raining labels inferred from measurements that cannot establish those conditions.

### Independent status signals

Maintain separate statuses for local acquisition and server persistence:

| Status | Meaning |
| --- | --- |
| Disconnected | This browser has no open instrument port |
| Waiting | Port is open; no valid observation yet |
| Receiving | Valid local observations are arriving |
| Stale | No recent valid observation within the configured threshold |
| Saving | Upload is pending or in progress |
| Saved | Server acknowledged the observation |
| Offline — queued | Local capture continues, but uploads are waiting |
| Recording paused | Storage, authentication, or another blocking issue requires attention |
| Demo | Every displayed observation is simulated |

Use a stale threshold of `max(10 seconds, 3 × expected output interval)` as the initial application policy. Show the last actual timestamp and preserve stale values with an explicit stale label.

On a second browser, show the station's server-observed freshness, not a claim that this viewing browser owns a serial connection. Do not merge a locally unsaved reading with server-saved status.

## 8. Historical views and statistics

- Provide 1-hour, 24-hour, 7-day, and custom ranges up to 31 days per request.
- Chart wind speed, temperature, humidity, and pressure. Include optional series only when meaningful.
- Provide hover/touch values, readable axes, unit labels, local station time, and explicit empty states.
- Aggregate on the server to approximately 600–1000 points per series. Do not send millions of samples to the browser.
- Preserve per-bucket sample count and min/max where needed so downsampling does not erase peaks.
- Leave gaps visible when data is missing; do not draw an apparently continuous measurement across an outage.
- Calculate averaged direction using circular/vector mathematics, not arithmetic mean degrees. Opposing/cancelling vectors have an undefined mean; show unavailable.
- Do not average averages without sample-count weighting. For irregular samples, define whether statistics are sample-weighted or time-weighted and label/document the choice.
- “Today” means midnight-to-now in the station's time zone, including daylight-saving transitions. “Last 24 hours” is a different range.
- Compare pressure readings over a stated window if showing a pressure trend. Avoid forecasting language.

## 9. Reliable logging and offline behavior

For each observation, generate a stable UUID once and store it in IndexedDB before considering it safely queued. Preserve its raw record, browser receipt timestamp, source session ID, sequence number, and immutable input-profile ID.

- At approximately one observation per second, batch uploads every 1–3 seconds; accept up to 100 observations per request.
- Keep the same observation ID through all retries.
- Independently validate raw records and profile interpretation on the server.
- Acknowledge accepted IDs, duplicate IDs, and rejected IDs with specific reasons.
- Remove an observation from the pending queue only after acknowledgement or deliberate quarantine of a rejected record.
- Retry transient failures with bounded exponential backoff and jitter. Honor server retry instructions.
- Resume pending uploads after a refresh or network recovery.
- Preserve pending records on session expiration. Prompt for sign-in and resume after successful authentication.
- Bound memory use and keep the durable queue in IndexedDB. Handle quota errors visibly and explain when recording has paused; never silently drop records.
- Keep the raw terminal display bounded, for example to the most recent 200 lines.
- Explain that browser storage is a recovery queue, not a replacement for the server database or its backups.

Record both browser receipt time and server receipt time in UTC. The instrument's stream has no timestamp in the supplied example, so do not describe the browser timestamp as an instrument-generated time. Detect significant client/server clock differences and show an actionable message.

Logout, refresh, disconnect, and tab close may stop capture. They must not falsely imply that the instrument continues logging to this application. Warn about unsent observations before a deliberate disconnect/navigation when the browser permits it.

## 10. Data model

Use migrations and parameterized queries. A suitable schema includes:

| Entity | Required information |
| --- | --- |
| Station | ID, name, time zone, display defaults, retention policy |
| Input profile | ID, station ID, immutable versioned interpretation settings, creation time |
| Capture session | ID, station ID, profile ID, source type, start/end times, source heartbeat |
| Observation | UUID, station/session/profile IDs, sequence, browser receipt time, server receipt time, normalized measurements, exact raw record, quality flags |
| Diagnostic event | Timestamp, bounded raw sample, error code, explanation, station/session IDs |

Store measurements in canonical units: m/s, °C, percent RH, hPa, mm where the rain field is understood, W/m², volts, and degrees. Keep original bytes/text and the profile needed to interpret them. Unsupported or uninstalled measurements are nullable.

Index by station and observation time, and enforce a unique observation UUID. Retries must be idempotent. Do not store the full profile JSON repeatedly on every observation if a foreign key can preserve the same information.

Default retention: 90 days, configurable by the owner. At one reading per second this is about 7.8 million observations per station; document measured storage use and provide cleanup, indexes, and tested backup/restore instructions. Keep cleanup and long exports from blocking live acquisition requests. A deployment restart must preserve history and settings.

## 11. API contract

All station data and settings require authentication. Keep frontend and API on the same origin.

| Method and route | Purpose |
| --- | --- |
| `POST /api/login` | Create an authenticated owner session |
| `POST /api/logout` | End the session |
| `GET /api/session` | Return authentication state and CSRF metadata |
| `GET /api/settings` | Return station settings and current input profile |
| `PUT /api/settings` | Update settings; interpretation changes create a new profile version |
| `POST /api/capture-sessions` | Register a browser capture session |
| `POST /api/observations/batch` | Validate and persist raw observations idempotently |
| `GET /api/status` | Return latest saved observation, freshness, and summaries |
| `GET /api/history` | Return bounded, aggregated series for a validated time range |
| `GET /api/diagnostics` | Return bounded diagnostic events and counters |
| `GET /api/export.csv` | Stream observations for an authenticated selected date range |
| `GET /healthz` | Minimal process/database readiness without exposing private data |

Example batch request shape:

```json
{
  "captureSessionId": "uuid",
  "profileId": "immutable-profile-id",
  "records": [
    {
      "id": "stable-observation-uuid",
      "sequence": 1,
      "observedAt": "2026-10-23T18:00:00.000Z",
      "raw": "000.6,272,+023.6,022,0974.3,000.00,0000,12.7,U0,*02355"
    }
  ]
}
```

The example timestamp is illustrative. A rejected observation must return its ID, machine-readable code, and useful explanation. Distinguish checksum failure, wrong layout, missing profile, invalid numeric value, unexpected units/range, invalid timestamp, oversized request, and temporary server failure. Use bounded request sizes, transactions, and appropriate HTTP status codes.

Polling approximately every 2 seconds for status and every 10–15 seconds for charts is sufficient initially. SSE may be used if it improves the implementation. Do not require WebSockets merely to render one station.

## 12. CSV export

- Export the selected range, with a documented maximum of 31 days per request.
- Stream large exports and respect backpressure.
- Include UTC browser/server timestamps, source/session IDs, canonical measurements with units in headers, input-profile ID, quality flags, and exact raw record.
- Include missing values as empty fields. Preserve valid negative numeric measurements.
- Correctly quote commas, quotes, and line endings. Escape spreadsheet formula injection in untrusted textual fields without corrupting typed numeric values.
- Make the canonical export units clear even when the dashboard displays imperial units.
- Export real data only. Demo exports, if offered, must be separate and explicitly named as simulated.

## 13. Authentication and deployment

- Generate unique credentials during setup; do not ship a working shared default password.
- Hash stored passwords or use a securely provisioned environment-based credential with appropriate verification.
- Use HttpOnly, SameSite cookies; require Secure cookies for the public HTTPS origin.
- Protect mutations against CSRF and validate request origins. Rate-limit authentication attempts.
- Validate all settings, timestamps, ranges, raw lines, and request sizes on the backend.
- Keep database files, environment files, backups, and server source outside the static asset directory.
- Use a restrictive CSP and permit serial access for the application origin, for example `Permissions-Policy: serial=(self)`.
- Avoid exposing the app inside an iframe. Do not use browser security-disabling flags as a deployment requirement.
- Provide `.env.example`, Dockerfile, Docker Compose with a persistent SQLite volume, and an Nginx HTTPS reverse-proxy example. Also document direct Node deployment with a process manager or systemd.
- Required configuration includes host/port, public HTTPS origin, owner credential, session secret, database directory, and retention days.
- Explain that serverless or ephemeral filesystems are unsuitable for this SQLite design unless durable storage is explicitly provisioned.
- Provide a safe SQLite-aware backup command and a restore procedure; copying an active database file alone must not be represented as a verified backup.

## 14. Demo and developer tools

Provide a serial adapter abstraction with both real Web Serial and simulated implementations. The simulator must generate properly framed, correctly checksummed records and support deliberate corruption, fragmented chunks, disconnects, and pauses.

Show a persistent “Demo — simulated data” label. Demo readings, queues, summaries, and exports must be isolated from real station records. Exiting demo restores the real dashboard without deleting real history or silently connecting to hardware.

## 15. Acceptance tests

Automate meaningful parser, API, persistence, queue, and UI checks. Include at least these cases:

1. Connect is initiated by a user action and opens the browser chooser.
2. The documented serial settings are used; a port is never selected by a hard-coded COM2 string.
3. A valid line split across arbitrary chunks produces one observation; multiple lines in one chunk all process correctly.
4. A split CR/LF terminator, empty lines, and an oversized line recover without duplicates or unbounded buffering.
5. The calculated `*02355` fixture validates; the supplied manual's `*02257` example fails under the stated checksum rule.
6. Whitespace is preserved for legacy checksum verification.
7. Layout mismatch and optional voltage/compass configurations are handled explicitly.
8. Confirmed metric and imperial inputs normalize correctly; display-unit changes do not change stored data.
9. Rain/solar absence does not become a zero measurement, and no unverified rainfall total is shown.
10. 359° and 1° directions average near north, not south; cancelling direction vectors show unavailable.
11. Unplugging, blocked permission, a busy port, malformed records, and stale data produce actionable states.
12. A two-minute server outage queues records; recovery uploads them once, preserving timestamps and UUIDs.
13. A response lost after commit can be retried without duplicating observations.
14. A profile change leaves older queued and historical observations correctly interpreted.
15. Queue quota failure and authentication expiry do not silently discard records or show false “Saved” status.
16. A second tab cannot claim capture ownership, while a phone can view uploaded history.
17. Restarting the application preserves settings and history; backup/restore works.
18. Today's summaries honor the selected time zone and a daylight-saving transition.
19. CSV has correct quoting, unit headers, missing values, and textual formula-injection handling.
20. Unauthenticated requests, CSRF attempts, invalid date ranges, oversized uploads, and access to private files are rejected.
21. Demo mode leaves real records and upload queues unchanged.
22. Production assets build successfully, documented deployment commands work, and the UI is usable on desktop and phone widths.

Tests may use a simulated serial adapter when hardware is unavailable. Report simulated verification separately from an actual AIO 2 hardware test. Obtain one captured real record and confirm its layout, units, and checksum before claiming verified hardware compatibility.

## 16. Required deliverables

- Complete source files, dependency lockfile, and build/start/test commands.
- Database schema and migrations.
- Working frontend with live serial acquisition, diagnostics, charts, durable queuing, and exports.
- Backend with authentication, validation, persistence, retention, and history aggregation.
- Simulator and automated tests.
- Deployment examples and `.env.example` containing placeholders only.
- README with an owner/server setup path and a separate end-user connection guide.
- A short list of verified behavior, hardware assumptions still requiring confirmation, and operational limits.

The required application is complete when a user can open the owner's hosted URL, sign in, connect the local instrument, understand its readings, save history, and download logs without writing code or using a terminal for routine operation.

## References and evidence

- User-supplied image: `IMG_4110.jpg`, AIO 2 Operation Manual Rev D, page 16. Primary reference for the supplied record layout and checksum description.
- [Met One AIO 2 Operation Manual, Rev G](https://metone.com/wp-content/uploads/2023/03/AIO-2-9800-Manual-Rev-G.pdf). Consult for firmware-specific optional fields, output settings, and commands; this application must not send configuration commands automatically.
- [Chrome: Read from and write to a serial port](https://developer.chrome.com/docs/capabilities/serial). Browser capability, permissions, and stream lifecycle.
- [MDN: Permissions-Policy serial directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/serial). Hosting permissions policy.
- [MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts). HTTPS and localhost requirements.

Application policies such as queue batching, stale thresholds, retention duration, display layout, and export limits are design decisions in this specification, not manufacturer guarantees.
