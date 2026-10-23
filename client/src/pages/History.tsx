import { Banner, Button, InlineStack, Text, TextField } from '@shopify/polaris';
import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import type { HistoryPoint } from '../../../shared/api';
import { formatStationTime } from '../../../shared/time';
import { cToDisplay, hpaToDisplay, msToDisplay, PRESSURE_DECIMALS, WIND_DECIMALS } from '../../../shared/units';
import { compassPoint } from '../../../shared/wind';
import { ForceLegend, WindDial } from '../components/WindDial';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { tempUnitLabel } from '../lib/format';
import { useCapture, usePoll } from '../lib/hooks';

const PRESETS = { '1 h': 3600_000, '24 h': 86_400_000, '7 days': 7 * 86_400_000 } as const;
type Preset = keyof typeof PRESETS | 'custom';

function toLocalInput(ms: number) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function History() {
  const { settings } = useApp();
  const cap = useCapture();
  const units = settings.station.displayUnits;
  const tz = settings.station.timeZone;
  const [preset, setPreset] = useState<Preset>('24 h');
  const [customFrom, setCustomFrom] = useState(toLocalInput(Date.now() - 3 * 86_400_000));
  const [customTo, setCustomTo] = useState(toLocalInput(Date.now()));

  const range = () => {
    if (preset !== 'custom') return { from: new Date(Date.now() - PRESETS[preset]), to: new Date() };
    return { from: new Date(customFrom), to: new Date(customTo) };
  };
  const customError = useMemo(() => {
    if (preset !== 'custom') return null;
    const f = Date.parse(customFrom);
    const t = Date.parse(customTo);
    if (!Number.isFinite(f) || !Number.isFinite(t)) return 'Pick a start and end';
    if (f >= t) return 'Start must be before end';
    if (t - f > 31 * 86_400_000) return 'Ranges are limited to 31 days';
    return null;
  }, [preset, customFrom, customTo]);

  const key = preset === 'custom' ? `${customFrom}|${customTo}` : preset;
  const hist = usePoll(customError ? null : () => { const r = range(); return api.history(r.from, r.to); }, 15_000, [key]);
  const rose = usePoll(customError ? null : () => { const r = range(); return api.windRose(r.from, r.to); }, 60_000, [key]);

  const data = useMemo(() => {
    if (!hist.data) return [];
    return hist.data.points.map((p: HistoryPoint) => ({
      t: p.t,
      n: p.n,
      ws: p.wsAvg == null ? null : msToDisplay(p.wsAvg, units.wind),
      wsMax: p.wsMax == null ? null : msToDisplay(p.wsMax, units.wind),
      dir: p.dir,
      at: p.atAvg == null ? null : cToDisplay(p.atAvg, units.temp),
      atRange: p.atMin == null || p.atMax == null ? null : [cToDisplay(p.atMin, units.temp), cToDisplay(p.atMax, units.temp)],
      rh: p.rhAvg,
      bp: p.bpAvg == null ? null : hpaToDisplay(p.bpAvg, units.pressure),
      sr: p.srAvg,
    }));
  }, [hist.data, units]);

  const span = hist.data ? Date.parse(hist.data.to) - Date.parse(hist.data.from) : 86_400_000;
  const tick = (t: number) => formatStationTime(t, tz, span > 2 * 86_400_000 ? { month: 'short', day: 'numeric' } : { hour: 'numeric', minute: '2-digit' });
  const tipLabel = (t: number) => formatStationTime(t, tz, { dateStyle: 'medium', timeStyle: 'short' });
  const empty = hist.data && hist.data.points.every((p) => p.n === 0);
  const r = range();
  const bucketText = hist.data ? `${Math.round(hist.data.bucketMs / 1000)} s` : '';
  const showSolar = settings.profile?.solarInstalled;

  const chart = (title: string, unit: string, children: React.ReactNode, domain?: [number | string, number | string]) => (
    <section className="panel chart-panel">
      <h2>{title} <small>{unit}</small></h2>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tick} stroke="#64748b" fontSize={12} minTickGap={40} />
          <YAxis stroke="#64748b" fontSize={12} width={52} domain={domain ?? ['auto', 'auto']} allowDecimals tickFormatter={(v: number) => (unit.startsWith('inHg') ? v.toFixed(2) : Number.isInteger(v) ? String(v) : v.toFixed(1))} />
          <Tooltip
            contentStyle={{ background: '#0b1220', border: '1px solid #334155', borderRadius: 8 }}
            labelFormatter={(t) => tipLabel(Number(t))}
            formatter={(v: unknown, name: string) => [Array.isArray(v) ? v.map((x: number) => x.toFixed(1)).join(' – ') : typeof v === 'number' ? v.toFixed(name === 'Pressure' ? PRESSURE_DECIMALS[units.pressure] : 1) : String(v), name]}
          />
          {children}
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  );

  return (
    <div className="history">
      <div className="history-head">
        <Text as="h1" variant="headingXl">History</Text>
        <div className="seg" role="group" aria-label="Range">
          {([...Object.keys(PRESETS), 'custom'] as Preset[]).map((p) => (
            <button key={p} className={p === preset ? 'on' : ''} onClick={() => setPreset(p)}>{p === 'custom' ? 'Custom' : p}</button>
          ))}
        </div>
        <Button url={customError ? undefined : api.exportUrl(r.from, r.to)} disabled={!!customError} external={false} download>Export this range (CSV)</Button>
      </div>
      {preset === 'custom' && (
        <InlineStack gap="300" blockAlign="end">
          <TextField label="From (this computer’s time)" type="datetime-local" value={customFrom} onChange={setCustomFrom} autoComplete="off" />
          <TextField label="To" type="datetime-local" value={customTo} onChange={setCustomTo} autoComplete="off" />
        </InlineStack>
      )}
      {cap.mode === 'demo' && <Banner tone="info"><p>History shows real saved readings only. Demo readings are never saved.</p></Banner>}
      {customError && <Banner tone="warning"><p>{customError}</p></Banner>}
      {hist.error && <Banner tone="critical"><p>{hist.error}</p></Banner>}
      {empty && <Banner tone="info"><p>No saved readings in this range.</p></Banner>}
      <p className="fine">
        Times in {tz}. Each point is the sample-weighted average of one {bucketText} bucket; gaps mean no readings were saved. Lines are not drawn across gaps.
      </p>

      <div className="history-grid">
        {chart('Wind speed', units.wind, <>
          <Area dataKey="wsMax" name="Peak reading" stroke="#f97316" fill="#f97316" fillOpacity={0.15} connectNulls={false} isAnimationActive={false} dot={false} />
          <Line dataKey="ws" name="Average" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        </>, [0, 'auto'])}
        {chart('Wind direction', '° (from)', <Scatter dataKey="dir" name="Mean direction" fill="#a78bfa" isAnimationActive={false} shape={<DirDot />} />, [0, 360])}
        {chart('Temperature', tempUnitLabel(units), <>
          <Area dataKey="atRange" name="Range" stroke="none" fill="#f59e0b" fillOpacity={0.15} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="at" name="Average" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        </>)}
        {chart('Humidity', '% RH', <Line dataKey="rh" name="Humidity" stroke="#22c55e" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />, [0, 100])}
        {chart('Pressure', `${units.pressure} (station)`, <Line dataKey="bp" name="Pressure" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />)}
        {showSolar && chart('Solar radiation', 'W/m²', <Line dataKey="sr" name="Solar" stroke="#eab308" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />, [0, 'auto'])}
        <section className="panel chart-panel rose-panel">
          <h2>Wind rose <small>{rose.data ? `${rose.data.total.toLocaleString()} readings · ${rose.data.calm.toLocaleString()} calm` : ''}</small></h2>
          <WindDial latest={null} trail={[]} rose={rose.data} units={units} stale={false} intervalMs={1000} />
          <ForceLegend units={units} />
        </section>
      </div>
      <p className="fine">Wind speed decimals: {WIND_DECIMALS[units.wind]}. Direction: mean of unit vectors per bucket, calm readings excluded; “unavailable” when directions cancel. {compassPoint(0)} = 0°.</p>
    </div>
  );
}

function DirDot(props: { cx?: number; cy?: number }) {
  if (props.cx == null || props.cy == null) return null;
  return <circle cx={props.cx} cy={props.cy} r={2} fill="#a78bfa" />;
}
