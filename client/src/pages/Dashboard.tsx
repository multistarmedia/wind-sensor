import { Banner, Button, ButtonGroup, Select } from '@shopify/polaris';
import { useMemo, useState } from 'react';
import type { HistoryResponse, StatusResponse, WindPoint } from '../../../shared/api';
import { staleThresholdMs } from '../../../shared/profile';
import { formatStationTime } from '../../../shared/time';
import {
  hpaToDisplay, PRESSURE_DECIMALS, PRESSURE_DISPLAY_UNITS, TEMP_DISPLAY_UNITS, WIND_DISPLAY_UNITS, type DisplayUnits,
} from '../../../shared/units';
import { compassPoint, isCalm } from '../../../shared/wind';
import { capture } from '../capture/controller';
import { ConnectButton } from '../components/ConnectButton';
import { Sparkline } from '../components/Sparkline';
import { ForceLegend, WindDial } from '../components/WindDial';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import {
  DASH, fmt, pressureText, pressureUnitLabel, rainText, tempText, tempUnitLabel, windText,
} from '../lib/format';
import { useCapture, useNow, usePoll } from '../lib/hooks';
import { localStatus, localWindRose } from '../lib/local';

const ROSE_WINDOWS = { '10m': 600_000, '1h': 3600_000, '24h': 86_400_000 } as const;
type RoseWindow = keyof typeof ROSE_WINDOWS;

const REFERENCE_TEXT = {
  magnetic: 'Directions relative to magnetic north',
  true: 'Directions relative to true north (declination set on the instrument)',
  unconfirmed: 'North reference not confirmed (magnetic or true)',
} as const;

export function Dashboard() {
  const { settings, setSettings, navigate } = useApp();
  const cap = useCapture();
  const now = useNow(1000);
  const [roseWindow, setRoseWindow] = useState<RoseWindow>('1h');
  const units = settings.station.displayUnits;
  const tz = settings.station.timeZone;
  const demo = cap.mode === 'demo';
  const profile = demo ? cap.profile : settings.profile;

  const serverStatus = usePoll(demo ? null : () => api.status(), 2000);
  const serverRose = usePoll(demo ? null : () => api.windRose(new Date(Date.now() - ROSE_WINDOWS[roseWindow]), new Date()), 15_000, [roseWindow]);
  const serverTrend = usePoll(demo ? null : () => api.history(new Date(Date.now() - 3600_000), new Date()), 15_000);

  const status: StatusResponse | null = demo ? localStatus(cap.recent, tz, now) : serverStatus.data;
  const rose = demo ? localWindRose(cap.recent, now - ROSE_WINDOWS[roseWindow], now + 1) : serverRose.data;
  const trend = useMemo(() => (demo ? demoTrend(cap.recent) : serverTrend.data), [demo, demo ? Math.floor(now / 10_000) : serverTrend.data]);

  // The capturing browser animates its own readings; viewers animate what the server has saved.
  const localLive = cap.mode !== 'off' && cap.recent.length > 0;
  const trail: WindPoint[] = localLive
    ? cap.recent.slice(-60).map((o) => ({ t: o.t, ws: o.m.windSpeedMs, wd: o.m.windDirDeg }))
    : status?.recent ?? [];
  const latestWind = trail[trail.length - 1] ?? null;
  const latestM = localLive ? cap.recent[cap.recent.length - 1]!.m : status?.latest?.m ?? null;
  const latestAt = localLive ? cap.recent[cap.recent.length - 1]!.t : status?.latest ? Date.parse(status.latest.observedAt) : null;
  const threshold = staleThresholdMs(profile?.intervalSeconds ?? 1);
  const stale = latestAt === null || now - latestAt > threshold;

  const setUnits = async (patch: Partial<DisplayUnits>) => {
    setSettings(await api.updateSettings({ station: { displayUnits: { ...units, ...patch } } }));
  };

  const w = status?.last10min;
  const t = status?.today;
  const series = (k: 'wsAvg' | 'atAvg' | 'rhAvg' | 'bpAvg') => trend?.points.map((p) => p[k]) ?? [];
  const at = (iso: string | null | undefined) => (iso ? formatStationTime(Date.parse(iso), tz) : '');

  return (
    <div className="dashboard">
      {cap.error && cap.mode === 'off' && (
        <Banner tone="critical" title="Instrument connection" onDismiss={() => capture.clearError()} action={{ content: 'Connection help', onAction: () => navigate('connection') }}>
          <p>{cap.error.message}</p>
        </Banner>
      )}
      {cap.recordingPaused && <Banner tone="critical" title="Recording paused"><p>{cap.recordingPaused}</p></Banner>}
      {cap.upload.state === 'paused' && cap.upload.message && <Banner tone="warning" title="Not saving"><p>{cap.upload.message}</p></Banner>}

      <div className="dash-actions">
        <ConnectButton />
        <div className="unit-pickers">
          <Select label="Wind units" labelHidden options={WIND_DISPLAY_UNITS.map((u) => ({ label: u, value: u }))} value={units.wind} onChange={(v) => void setUnits({ wind: v as DisplayUnits['wind'] })} disabled={demo} />
          <Select label="Temperature units" labelHidden options={TEMP_DISPLAY_UNITS.map((u) => ({ label: `°${u}`, value: u }))} value={units.temp} onChange={(v) => void setUnits({ temp: v as DisplayUnits['temp'] })} disabled={demo} />
          <Select label="Pressure units" labelHidden options={PRESSURE_DISPLAY_UNITS.map((u) => ({ label: u, value: u }))} value={units.pressure} onChange={(v) => void setUnits({ pressure: v as DisplayUnits['pressure'] })} disabled={demo} />
        </div>
        <ButtonGroup>
          <Button onClick={() => navigate('history')}>History</Button>
          <Button onClick={() => navigate('log')}>Log &amp; export</Button>
        </ButtonGroup>
      </div>

      <div className="dash-grid">
        <section className="panel wind-panel">
          <header className="panel-head">
            <h2>Wind</h2>
            <div className="seg" role="group" aria-label="Wind rose period">
              {(Object.keys(ROSE_WINDOWS) as RoseWindow[]).map((k) => (
                <button key={k} className={k === roseWindow ? 'on' : ''} onClick={() => setRoseWindow(k)}>{k}</button>
              ))}
            </div>
          </header>
          <WindDial latest={latestWind} trail={trail} rose={rose} units={units} stale={stale} intervalMs={(profile?.intervalSeconds ?? 1) * 1000} />
          <p className="wind-caption">
            {latestWind ? (isCalm(latestWind.ws) ? 'Calm' : `Wind from ${compassPoint(latestWind.wd)} · ${Math.round(latestWind.wd)}°`) : 'No readings yet'}
            {stale && latestAt !== null && <span className="stale-tag">Stale · last reading {formatStationTime(latestAt, tz, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>}
          </p>
          <ForceLegend units={units} />
          <p className="fine">
            Rose: share of readings by direction over the last {roseWindow}, coloured by Beaufort force
            {rose ? ` (${rose.total} readings, ${rose.calm} calm)` : ''}. Arrow points from where the wind comes from. Rim dots fade over 60 s.
          </p>
          <p className="fine">{REFERENCE_TEXT[profile?.directionReference ?? 'unconfirmed']}</p>
        </section>

        <section className="panel wind-stats">
          <h2>Wind detail</h2>
          <dl className="stat-list">
            <div><dt>Now</dt><dd><b>{windText(latestM?.windSpeedMs, units)}</b> {units.wind}</dd></div>
            <div><dt>Average · last 10 min</dt><dd><b>{windText(w?.avgSpeedMs, units)}</b> {units.wind}</dd></div>
            <div><dt>Peak reading · last 10 min</dt><dd><b>{windText(w?.peakSpeedMs, units)}</b> {units.wind} <small>{at(w?.peakAt)}</small></dd></div>
            <div><dt>Mean direction · last 10 min</dt><dd><b>{w?.meanDirDeg == null ? DASH : `${compassPoint(w.meanDirDeg)} ${Math.round(w.meanDirDeg)}°`}</b></dd></div>
            <div><dt>Peak reading · today</dt><dd><b>{windText(t?.peakWindMs, units)}</b> {units.wind} <small>{at(t?.peakWindAt)}</small></dd></div>
          </dl>
          <Sparkline values={series('wsAvg')} color="#38bdf8" />
          <p className="fine">Last hour, average per bucket. “Peak reading” is the highest single reading, not a standards-defined gust.</p>
        </section>

        <StatCard title="Temperature" value={tempText(latestM?.airTempC, units)} unit={tempUnitLabel(units)} spark={series('atAvg')} color="#f59e0b"
          lines={[`Today high ${tempText(t?.tempHighC, units)} ${at(t?.tempHighAt)}`, `Today low ${tempText(t?.tempLowC, units)} ${at(t?.tempLowAt)}`]} />
        <StatCard title="Humidity" value={fmt(latestM?.rhPct, 0)} unit="% RH" spark={series('rhAvg')} color="#22c55e" lines={['Relative humidity']} />
        <StatCard title="Pressure" value={pressureText(latestM?.pressureHpa, units)} unit={pressureUnitLabel(units)} spark={series('bpAvg')} color="#a78bfa"
          lines={['Station pressure (not sea-level)', pressureTrendText(status, units)]} />
        {profile?.rainGaugeInstalled && (
          <StatCard title="Rain field" value={rainText(latestM?.rainMm, units)} unit={units.rain} lines={['Raw value from the rain-gauge field. Totals and rates are not calculated until the instrument’s reset behaviour is verified.']} />
        )}
        {profile?.solarInstalled && <StatCard title="Solar radiation" value={fmt(latestM?.solarWm2, 0)} unit="W/m²" lines={['External solar sensor']} />}
        {latestM?.supplyV != null && <StatCard title="Supply voltage" value={fmt(latestM.supplyV, 1)} unit="V" lines={['Instrument power supply (health reading)']} />}
      </div>
      <section className="panel guide-panel">
        <h2>Getting started video</h2>
        <video className="guide-video" src="/videos/getting-started.mp4" poster="/videos/getting-started.jpg" controls preload="metadata" playsInline />
        <p className="fine">2½ minutes with captions. Dashboard scenes use demo mode; history and log scenes use simulated readings, labelled on screen.</p>
      </section>
      <p className="fine center">
        Times shown in {tz}. {demo ? 'Demo readings are simulated and never saved.' : `Readings are timestamped by the capture browser when received.`}
      </p>
    </div>
  );
}

function pressureTrendText(s: StatusResponse | null, u: DisplayUnits) {
  const c = s?.pressureTrend.changeHpa;
  if (c == null) return 'Change over 3 h: —';
  const v = hpaToDisplay(Math.abs(c), u.pressure).toFixed(PRESSURE_DECIMALS[u.pressure]);
  return `Change over 3 h: ${c >= 0 ? '+' : '−'}${v} ${u.pressure}`;
}

function StatCard({ title, value, unit, lines, spark, color }: { title: string; value: string; unit: string; lines: string[]; spark?: (number | null)[]; color?: string }) {
  return (
    <section className="panel stat-card">
      <h2>{title}</h2>
      <div className="big"><b>{value}</b><span>{unit}</span></div>
      {lines.map((l) => <p key={l} className="sub">{l}</p>)}
      {spark && <Sparkline values={spark} color={color} />}
    </section>
  );
}

function demoTrend(recent: { t: number; m: { windSpeedMs: number; airTempC: number; rhPct: number; pressureHpa: number } }[]): HistoryResponse {
  const bucket = 10_000;
  const end = Date.now();
  const start = end - 3600_000;
  const n = Math.ceil((end - start) / bucket);
  const acc = Array.from({ length: n }, () => ({ c: 0, ws: 0, at: 0, rh: 0, bp: 0 }));
  for (const o of recent) {
    const i = Math.floor((o.t - start) / bucket);
    if (i < 0 || i >= n) continue;
    const a = acc[i]!;
    a.c++; a.ws += o.m.windSpeedMs; a.at += o.m.airTempC; a.rh += o.m.rhPct; a.bp += o.m.pressureHpa;
  }
  return {
    from: new Date(start).toISOString(), to: new Date(end).toISOString(), bucketMs: bucket,
    points: acc.map((a, i) => ({
      t: start + i * bucket, n: a.c,
      wsAvg: a.c ? a.ws / a.c : null, wsMax: null, dir: null, atAvg: a.c ? a.at / a.c : null, atMin: null, atMax: null,
      rhAvg: a.c ? a.rh / a.c : null, bpAvg: a.c ? a.bp / a.c : null, bpMin: null, bpMax: null, srAvg: null, srMax: null, bvAvg: null,
    })),
  };
}
