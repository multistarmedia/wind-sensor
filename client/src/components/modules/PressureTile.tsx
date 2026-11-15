import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatStationTime } from '../../../../shared/time';
import { hpaToDisplay, PRESSURE_DECIMALS, PRESSURE_DISPLAY_UNITS, type DisplayUnits } from '../../../../shared/units';
import { api } from '../../lib/api';
import { pressureText, pressureUnitLabel } from '../../lib/format';
import { usePoll } from '../../lib/hooks';
import { useStationNow } from '../../lib/station';
import { PressureDial } from './PressureDial';
import { TileShell } from './TileShell';

const RANGES = {
  '1h': 3600_000,
  '6h': 6 * 3600_000,
  '12h': 12 * 3600_000,
  '24h': 24 * 3600_000,
} as const;
type RangeKey = keyof typeof RANGES;

/** Smooth demo station-pressure curve for windows longer than the live buffer. */
function demoPressureSeries(now: number, windowMs: number, tipHpa: number | null): { t: number; hpa: number }[] {
  const n = Math.min(240, Math.max(72, Math.round(windowMs / 600_000)));
  const step = windowMs / Math.max(1, n - 1);
  const tip = tipHpa ?? 1013;
  const out: { t: number; hpa: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = now - windowMs + i * step;
    const ageH = (now - t) / 3600_000;
    const hpa =
      tip +
      1.6 * Math.sin((t / 3600_000 / 9) * 2 * Math.PI + 0.4) +
      0.9 * Math.sin((t / 3600_000 / 3.2) * 2 * Math.PI + 1.2) -
      0.05 * ageH;
    out.push({ t, hpa });
  }
  out[out.length - 1] = { t: now, hpa: tip };
  return out;
}

export function PressureTile() {
  const s = useStationNow();
  const [range, setRange] = useState<RangeKey>('6h');
  const decimals = PRESSURE_DECIMALS[s.units.pressure];
  const unit = pressureUnitLabel(s.units);
  const hpa = s.latestM?.pressureHpa ?? null;
  const windowMs = RANGES[range];
  const recentSpan = s.cap.recent.length > 0 ? s.now - s.cap.recent[0]!.t : 0;
  const recentCovers = recentSpan + 60_000 >= windowMs;

  const hist = usePoll(
    s.demo || recentCovers ? null : () => api.history(new Date(s.now - windowMs), new Date()),
    15_000,
    [range, windowMs, recentCovers],
  );

  const series = useMemo(() => {
    const since = s.now - windowMs;
    const show = (h: number) => hpaToDisplay(h, s.units.pressure);

    if (recentCovers && s.cap.recent.length > 0) {
      return s.cap.recent
        .filter((o) => o.t >= since)
        .map((o) => ({ t: o.t, v: show(o.m.pressureHpa) }));
    }

    if (s.demo) {
      const synth = demoPressureSeries(s.now, windowMs, hpa);
      const live = s.cap.recent.filter((o) => o.t >= since);
      if (live.length === 0) return synth.map((p) => ({ t: p.t, v: show(p.hpa) }));
      const liveStart = live[0]!.t;
      return [
        ...synth.filter((p) => p.t < liveStart).map((p) => ({ t: p.t, v: show(p.hpa) })),
        ...live.map((o) => ({ t: o.t, v: show(o.m.pressureHpa) })),
      ];
    }

    return (hist.data?.points ?? [])
      .filter((p) => p.bpAvg != null)
      .map((p) => ({ t: p.t, v: show(p.bpAvg!) }));
  }, [s.cap.recent, s.now, s.demo, windowMs, recentCovers, s.units.pressure, hist.data, hpa]);

  const changeHpa = s.status?.pressureTrend.changeHpa ?? null;
  const tendency = (() => {
    if (changeHpa == null) return null;
    const v = hpaToDisplay(Math.abs(changeHpa), s.units.pressure).toFixed(decimals);
    const dir = changeHpa > 0.05 ? 'Rising' : changeHpa < -0.05 ? 'Falling' : 'Steady';
    return `${dir} ${changeHpa >= 0 ? '+' : '−'}${v} / 3 h`;
  })();

  return (
    <TileShell
      title="BAROMETRIC PRESSURE"
      stale={s.stale}
      control={(
        <div className="seg" role="group" aria-label="Pressure units">
          {PRESSURE_DISPLAY_UNITS.map((u) => (
            <button
              key={u}
              type="button"
              className={u === s.units.pressure ? 'on' : ''}
              onClick={() => void s.setUnits({ pressure: u as DisplayUnits['pressure'] })}
            >
              {u}
            </button>
          ))}
        </div>
      )}
    >
      <div className="pressure-tile-body">
        <div className="pressure-hero">
          <PressureDial
            hpa={hpa}
            label={`${pressureText(hpa, s.units)} ${unit}`}
            scaleUnit={s.units.pressure === 'mbar' || s.units.pressure === 'hPa' ? s.units.pressure : 'hPa'}
          />
          {tendency && <p className="pressure-tendency">{tendency}</p>}
        </div>
        <div className="pressure-tile-chart" aria-label="Live station-pressure history">
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <ComposedChart data={series} margin={{ top: 6, right: 8, bottom: 4, left: 2 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
              <YAxis
                stroke="#64748b"
                fontSize={10}
                width={42}
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => v.toFixed(decimals)}
              />
              <Tooltip
                contentStyle={{ background: '#0b1220', border: '1px solid #334155', borderRadius: 8 }}
                labelFormatter={(t) => formatStationTime(Number(t), s.tz, { timeStyle: 'medium' })}
                formatter={(v: unknown) => [typeof v === 'number' ? v.toFixed(decimals) : String(v), unit]}
              />
              <Area dataKey="v" stroke="none" fill="#00B7FF" fillOpacity={0.16} connectNulls={false} isAnimationActive={false} />
              <Line dataKey="v" stroke="#00E676" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="pressure-range-bar" role="group" aria-label="Live history range">
          {(Object.keys(RANGES) as RangeKey[]).map((k) => (
            <button
              key={k}
              type="button"
              className={k === range ? 'on' : ''}
              onClick={() => setRange(k)}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
    </TileShell>
  );
}
