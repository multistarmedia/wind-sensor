import { useMemo, useState } from 'react';
import type { HistoryResponse, WindPoint } from '../../../../shared/api';
import { formatStationTime } from '../../../../shared/time';
import { msToDisplay, WIND_DISPLAY_UNITS, type DisplayUnits } from '../../../../shared/units';
import { beaufortForce, BEAUFORT_NAMES, compassPoint, isCalm } from '../../../../shared/wind';
import {
  displayToMs, maxSpeedSliderBounds, paletteGradientCss,
  WIND_COLOR_PALETTES, WIND_PALETTE_OPTIONS,
} from '../../../../shared/windColors';
import {
  DEFAULT_WIND_STAT_WINDOW, WIND_STAT_WINDOWS, windStatWindow, type WindStatWindowId,
} from '../../../../shared/windStatWindows';
import { Sparkline } from '../Sparkline';
import { WindDial } from '../WindDial';
import { api } from '../../lib/api';
import { DASH, windText } from '../../lib/format';
import { usePoll } from '../../lib/hooks';
import { localWindRose, localWindStats } from '../../lib/local';
import { useWindColorPrefs } from '../../lib/windColorPrefs';
import { useStationNow } from '../../lib/station';
import { TileShell } from './TileShell';

const ROSE_WINDOWS = { '10m': 600_000, '1h': 3600_000, '24h': 86_400_000 } as const;
type RoseWindow = keyof typeof ROSE_WINDOWS;

const REFERENCE_TEXT = {
  magnetic: 'Directions relative to magnetic north',
  true: 'Directions relative to true north (declination set on the instrument)',
  unconfirmed: 'North reference not confirmed (magnetic or true)',
} as const;

export function WindTile() {
  const s = useStationNow();
  const [roseWindow, setRoseWindow] = useState<RoseWindow>('10m');
  const [statWindowId, setStatWindowId] = useState<WindStatWindowId>(DEFAULT_WIND_STAT_WINDOW);
  const [colorPrefs, updateColorPrefs] = useWindColorPrefs();
  const statWin = windStatWindow(statWindowId);
  const statsPollMs = statWin.ms <= 60_000 ? 2_000 : 15_000;
  const serverRose = usePoll(s.demo ? null : () => api.windRose(new Date(Date.now() - ROSE_WINDOWS[roseWindow]), new Date()), 15_000, [roseWindow]);
  const serverTrend = usePoll(s.demo ? null : () => api.history(new Date(Date.now() - 3600_000), new Date()), 15_000);
  const serverStats = usePoll(
    s.demo ? null : () => api.windStats(new Date(Date.now() - statWin.ms), new Date()),
    statsPollMs,
    [statWin.ms],
  );
  const rose = s.demo ? localWindRose(s.cap.recent, s.now - ROSE_WINDOWS[roseWindow], s.now + 1) : serverRose.data;
  const trend = useMemo(() => (s.demo ? demoWindTrend(s.cap.recent) : serverTrend.data), [s.demo, s.demo ? Math.floor(s.now / 10_000) : serverTrend.data]);
  const windowStats = useMemo(
    () => (s.demo ? localWindStats(s.cap.recent, s.now - statWin.ms, s.now) : serverStats.data),
    [s.demo, s.demo ? s.cap.recent : null, s.demo ? Math.floor(s.now / 1_000) : null, statWin.ms, serverStats.data],
  );

  const palette = WIND_COLOR_PALETTES[colorPrefs.paletteId];
  const maxSpeedMs = colorPrefs.maxSpeedMs;
  const bounds = maxSpeedSliderBounds(s.units.wind);
  const maxDisplay = msToDisplay(maxSpeedMs, s.units.wind);
  const sliderValue = Math.min(bounds.max, Math.max(bounds.min, maxDisplay));

  function setMaxFromDisplay(displayVal: number) {
    if (!Number.isFinite(displayVal)) return;
    updateColorPrefs({ maxSpeedMs: displayToMs(displayVal, s.units.wind) });
  }

  const localLive = s.cap.mode !== 'off' && s.cap.recent.length > 0;
  const trail: WindPoint[] = localLive
    ? s.cap.recent.slice(-60).map((o) => ({ t: o.t, ws: o.m.windSpeedMs, wd: o.m.windDirDeg }))
    : s.status?.recent ?? [];
  const latestWind = trail[trail.length - 1] ?? null;
  const w = windowStats;
  const t = s.status?.today;
  const series = trend?.points.map((p) => p.wsAvg) ?? [];
  const at = (iso: string | null | undefined) => (iso ? formatStationTime(Date.parse(iso), s.tz) : '');
  const beaufortLabel = (() => {
    const ms = s.latestM?.windSpeedMs;
    if (ms == null) return DASH;
    if (isCalm(ms)) return 'Calm';
    const f = beaufortForce(ms);
    return f > 0 ? (BEAUFORT_NAMES[f - 1] ?? DASH) : 'Calm';
  })();

  return (
    <TileShell
      className="wind-tile"
      title="Wind"
      stale={s.stale}
      control={(
        <>
          <div className="seg" role="group" aria-label="Wind units">
            {WIND_DISPLAY_UNITS.map((u) => (
              <button key={u} type="button" className={u === s.units.wind ? 'on' : ''} onClick={() => void s.setUnits({ wind: u as DisplayUnits['wind'] })}>{u}</button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Wind rose period">
            {(Object.keys(ROSE_WINDOWS) as RoseWindow[]).map((k) => (
              <button key={k} type="button" className={k === roseWindow ? 'on' : ''} onClick={() => setRoseWindow(k)}>{k}</button>
            ))}
          </div>
        </>
      )}
    >
      <div className="wind-tile-body">
        <div className="wind-tile-dial">
          <WindDial
            latest={latestWind}
            trail={trail}
            rose={rose}
            units={s.units}
            stale={s.stale}
            intervalMs={(s.profile?.intervalSeconds ?? 1) * 1000}
            palette={palette}
            maxSpeedMs={maxSpeedMs}
          />
          <p className="wind-caption">
            {latestWind ? (isCalm(latestWind.ws) ? 'Calm' : `Wind from ${compassPoint(latestWind.wd)} · ${Math.round(latestWind.wd)}°`) : 'No readings yet'}
          </p>
          <div className="wind-color-controls">
            <div className="seg" role="group" aria-label="Wind colour palette">
              {WIND_PALETTE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={opt.id === colorPrefs.paletteId ? 'on' : ''}
                  onClick={() => updateColorPrefs({ paletteId: opt.id })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <label className="wind-scale-max">
              <span>Max colour at</span>
              <input
                type="number"
                min={bounds.min}
                max={bounds.max}
                step={bounds.step}
                value={Number(maxDisplay.toFixed(bounds.step < 1 ? 1 : 0))}
                aria-label={`Maximum colour speed in ${s.units.wind}`}
                onChange={(e) => setMaxFromDisplay(Number(e.target.value))}
              />
              <span>{s.units.wind}</span>
            </label>
            <div
              className="wind-scale-track"
              style={{ background: paletteGradientCss(palette) }}
            >
              <input
                type="range"
                min={bounds.min}
                max={bounds.max}
                step={bounds.step}
                value={Number(sliderValue.toFixed(bounds.step < 1 ? 1 : 0))}
                aria-valuetext={`${sliderValue.toFixed(bounds.step < 1 ? 1 : 0)} ${s.units.wind} and above use the top colour`}
                onChange={(e) => setMaxFromDisplay(Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <footer className="wind-tile-footer">
          <div className="wind-footer-toolbar">
            <label className="wind-stat-period">
              <span>Period</span>
              <select
                value={statWindowId}
                aria-label="Average, peak, and mean direction period"
                onChange={(e) => setStatWindowId(e.target.value as WindStatWindowId)}
              >
                {WIND_STAT_WINDOWS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </label>
            <span className="wind-beaufort" aria-label="Beaufort force">{beaufortLabel}</span>
          </div>
          <dl className="wind-footer-stats">
            <div><dt>Now</dt><dd><b>{windText(s.latestM?.windSpeedMs, s.units)}</b> {s.units.wind}</dd></div>
            <div><dt>Average</dt><dd><b>{windText(w?.avgSpeedMs, s.units)}</b> {s.units.wind}</dd></div>
            <div><dt>Peak</dt><dd><b>{windText(w?.peakSpeedMs, s.units)}</b> {s.units.wind} <small>{at(w?.peakAt)}</small></dd></div>
            <div><dt>Mean dir</dt><dd><b>{w?.meanDirDeg == null ? DASH : `${compassPoint(w.meanDirDeg)} ${Math.round(w.meanDirDeg)}°`}</b></dd></div>
            <div><dt>Peak · today</dt><dd><b>{windText(t?.peakWindMs, s.units)}</b> {s.units.wind} <small>{at(t?.peakWindAt)}</small></dd></div>
          </dl>
          <Sparkline values={series} color="#38bdf8" />
          <p className="fine">{REFERENCE_TEXT[s.profile?.directionReference ?? 'unconfirmed']}</p>
        </footer>
      </div>
    </TileShell>
  );
}

function demoWindTrend(recent: { t: number; m: { windSpeedMs: number } }[]): HistoryResponse {
  const bucket = 10_000;
  const end = Date.now();
  const start = end - 3600_000;
  const n = Math.ceil((end - start) / bucket);
  const acc = Array.from({ length: n }, () => ({ c: 0, ws: 0 }));
  for (const o of recent) {
    const i = Math.floor((o.t - start) / bucket);
    if (i < 0 || i >= n) continue;
    const a = acc[i]!;
    a.c++; a.ws += o.m.windSpeedMs;
  }
  return {
    from: new Date(start).toISOString(), to: new Date(end).toISOString(), bucketMs: bucket,
    points: acc.map((a, i) => ({
      t: start + i * bucket, n: a.c,
      wsAvg: a.c ? a.ws / a.c : null, wsMax: null, dir: null, atAvg: null, atMin: null, atMax: null,
      rhAvg: null, bpAvg: null, bpMin: null, bpMax: null, srAvg: null, srMax: null, bvAvg: null,
    })),
  };
}
