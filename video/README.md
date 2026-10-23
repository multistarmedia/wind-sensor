# Narrated videos

A narrated, captioned walkthrough of the console, generated from code. It is ported from the Intelli404 training
pipeline, but this app is a normal top-level page with a local login, so Playwright drives every scene itself. No
hand-made screen recording is needed.

```
outline.ts + en.json        scenes (cards / live) + the words
      │
      ├─ narration.ts       ElevenLabs MP3 per line (cached) → durations-<set>.json
      ├─ record.spec.ts     Playwright, 1920×1080: cards and live app scenes, each held for its line
      │                     (actions.ts says what happens on screen; slow waits are cut out)
      └─ merge.ts           cuts removed, each line laid at its scene's start, captions burned in
```

One command does everything:

```bash
node video/make.mjs            # → video/out/getting-started-subtitled.mp4
SKIP_BUILD=1 node video/make.mjs
FORCE=1 npx tsx video/narration.ts   # re-voice every line (after changing voice settings)
```

`make.mjs` does the following:

1. Builds the app.
2. Starts a **throwaway server** on port 3300 with a random password and an empty database in `video/.data/`.
3. Records against it.
4. Stops the server and deletes that database.

The real station is never touched.

## Setup

- `.env` (never committed):
  - `ELEVENLABS_API_KEY`
  - `ELEVENLABS_VOICE_ID=nPczCjzI2devNBz1zQrb` ("Brian", a premade American male narrator voice)
  - Optional: `ELEVENLABS_MODEL`, `ELEVENLABS_STABILITY`, `ELEVENLABS_SPEED`
- `npx playwright install chromium`
- ffmpeg with libass on PATH (`brew install ffmpeg`)

## Data rules

- **Dashboard scenes** use the app's own demo mode, with its "Demo — simulated data" ribbon on screen.
- **History, log and phone scenes** need saved readings, and there is no real station data yet. `seed.ts` uploads
  24 hours of simulator readings through the real API into the throwaway database. Every one of those shots carries a
  "SIMULATED READINGS · recorded for this video" label, and the narration says so. Replace these with real readings
  once the station has logged a day, and remove the label and the line.
- No invented numbers or claims in the words.

## Changing words or scenes

- **Words:** edit `getting-started/en.json` (`text` is spoken; `caption` overrides the caption when the spoken form
  differs, e.g. "wind sensor dot on forge dot com"). Then run `make.mjs` again; only changed lines are re-voiced.
- **On-screen steps:** edit `getting-started/actions.ts`. The camera helpers are in `camera.ts` (`zoomTo`, `spotlight`,
  `glideTo`, `pointAt`, `labelSimulated`).
- **Cards:** `cards/title-card.html` and `cards/screen-card.html`. Config is JSON in the URL hash, and entrances are
  fractions of `duration`. Open a card without a hash to preview it looping.
- **Pacing:** about 0.6 s of silence after each line, 1.6 s on the outro.
