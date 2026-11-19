import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatStationTime } from '../../../../shared/time';
import { hpaToDisplay, PRESSURE_DECIMALS, PRESSURE_DISPLAY_UNITS, type DisplayUnits } from '../../../../shared/units';
import { schemeChartColors } from '../../../../shared/windColors';
import { api } from '../../lib/api';
import { pressureText, pressureUnitLabel } from '../../lib/format';
import { usePoll } from '../../lib/hooks';
import { useStationNow } from '../../lib/station';
import { useWindColorPrefs } from '../../lib/windColorPrefs';
import { PressureDial } from './PressureDial';
import { TileShell } from './TileShell';

const RANGES = {
  '1h': 3600_000,
  '6h': 6 * 3600_000,
  '12h': 12 * 3600_000,
  '24h': 24 * 3600_000,
} as const;
type RangeKey = keyof typeof RANGES;

type SeriesPoint = { t: number; v: number; avg: number };

/** Synoptic / diurnal trend (no short-wave texture). */
function demoPressureTrend(t: number, now: number, tip: number, windowMs: number): number {
  const ageH = (now - t) / 3600_000;
  // 1 h: gentle tendency only — real station pressure barely moves in an hour.
  if (windowMs <= 3600_000) {
    return (
      tip +
      0.14 * Math.sin((t / 2_700_000) * 2 * Math.PI + 0.85) +
      0.07 * Math.sin((t / 1_200_000) * 2 * Math.PI + 1.4) -
      0.09 * ageH
    );
  }
  const day = t / 86_400_000;
  return (
    tip +
    1.65 * Math.sin((day / 3.4) * 2 * Math.PI + 0.4) +
    1.05 * Math.sin((day / 1.15) * 2 * Math.PI + 1.2) +
    0.42 * Math.sin((day / 0.42) * 2 * Math.PI + 2.1) +
    0.22 * Math.sin((t / 310_000) * 2 * Math.PI + 0.3) -
    0.045 * ageH
  );
}

/**
 * Texture layered on the trend. Short windows use minute-scale undulation only
 * so 1 h does not read as high-frequency scribble.
 */
function demoPressureTexture(t: number, windowMs: number): number {
  if (windowMs <= 3600_000) {
    return (
      0.035 * Math.sin((t / 720_000) * 2 * Math.PI + 0.5) +
      0.018 * Math.sin((t / 360_000) * 2 * Math.PI + 1.7) +
      0.008 * Math.sin((t / 180_000) * 2 * Math.PI)
    );
  }
  return (
    0.14 * Math.sin((t / 140_000) * 2 * Math.PI + 0.7) +
    0.08 * Math.sin((t / 55_000) * 2 * Math.PI + 1.9) +
    0.04 * Math.sin((t / 22_000) * 2 * Math.PI + 0.5) +
    0.018 * Math.sin((t / 9_000) * 2 * Math.PI)
  );
}

/** High-resolution demo station-pressure curve (full window, tip pinned to live). */
function demoPressureSeries(now: number, windowMs: number, tipHpa: number | null): { t: number; hpa: number; avg: number }[] {
  // 1 h: ~1 sample / 8 s is enough for a smooth path; longer windows stay denser.
  const sampleMs = windowMs <= 3600_000 ? 8_000 : 4_500;
  const n = Math.min(1600, Math.max(windowMs <= 3600_000 ? 240 : 480, Math.round(windowMs / sampleMs)));
  const step = windowMs / Math.max(1, n - 1);
  const tip = tipHpa ?? 1013;
  const out: { t: number; hpa: number; avg: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = now - windowMs + i * step;
    const avg = demoPressureTrend(t, now, tip, windowMs);
    out.push({ t, hpa: avg + demoPressureTexture(t, windowMs), avg });
  }
  out[out.length - 1] = { t: now, hpa: tip, avg: tip };
  return out;
}

/**
 * Downsample while keeping bucket min/max so peaks and troughs stay visible
 * (uniform stride alone erases the detail we just added).
 */
function downsampleExtrema(
  points: SeriesPoint[],
  maxPoints: number,
): SeriesPoint[] {
  if (points.length <= maxPoints) return points;
  const buckets = Math.max(2, Math.floor(maxPoints / 2));
  const out: SeriesPoint[] = [];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * points.length) / buckets);
    const end = Math.floor(((b + 1) * points.length) / buckets);
    let minP = points[start]!;
    let maxP = points[start]!;
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      if (p.v < minP.v) minP = p;
      if (p.v > maxP.v) maxP = p;
    }
    if (minP.t <= maxP.t) {
      out.push(minP);
      if (maxP.t !== minP.t) out.push(maxP);
    } else {
      out.push(maxP);
      if (minP.t !== maxP.t) out.push(minP);
    }
  }
  const last = points[points.length - 1]!;
  if (out[out.length - 1]!.t !== last.t) out.push(last);
  return out;
}

/** Centered moving average so the solid line sits through short-wave texture. */
function withMovingAverage(points: { t: number; v: number }[], windowMs: number): SeriesPoint[] {
  if (points.length === 0) return [];
  const half = Math.max(1, windowMs / 2);
  return points.map((p, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0; j--) {
      const q = points[j]!;
      if (p.t - q.t > half) break;
      sum += q.v;
      n++;
    }
    for (let j = i + 1; j < points.length; j++) {
      const q = points[j]!;
      if (q.t - p.t > half) break;
      sum += q.v;
      n++;
    }
    return { t: p.t, v: p.v, avg: n > 0 ? sum / n : p.v };
  });
}

export function PressureTile() {
  const s = useStationNow();
  const [colorPrefs] = useWindColorPrefs();
  const colors = schemeChartColors(colorPrefs.paletteId);
  const [range, setRange] = useState<RangeKey>('1h');
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
    const MAX_POINTS = 1600;
    // MA window scales mildly with range so the solid line stays a readable mid-spine.
    const avgWindowMs = Math.min(20 * 60_000, Math.max(3 * 60_000, windowMs / 40));

    if (s.demo) {
      // Full-window dense synth (tip = live) — avoids a coarse/fine splice seam.
      return demoPressureSeries(s.now, windowMs, hpa).map((p) => ({
        t: p.t,
        v: show(p.hpa),
        avg: show(p.avg),
      }));
    }

    if (recentCovers && s.cap.recent.length > 0) {
      const raw = s.cap.recent
        .filter((o) => o.t >= since)
        .map((o) => ({ t: o.t, v: show(o.m.pressureHpa) }));
      return downsampleExtrema(withMovingAverage(raw, avgWindowMs), MAX_POINTS);
    }

    const histPts = (hist.data?.points ?? [])
      .filter((p) => p.bpAvg != null)
      .map((p) => ({ t: p.t, v: show(p.bpAvg!) }));
    return withMovingAverage(histPts, avgWindowMs);
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
          <ResponsiveContainer width="100%" height="100%" debounce={30}>
            <ComposedChart data={series} margin={{ top: 6, right: 8, bottom: 4, left: 2 }}>
              <defs>
                <linearGradient id="pressureFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.fill} stopOpacity={0.42} />
                  <stop offset="55%" stopColor={colors.fill} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={colors.fill} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#2a3a52" strokeDasharray="1 4" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
              <YAxis
                stroke="#64748b"
                fontSize={10}
                width={46}
                tickCount={9}
                allowDecimals
                domain={([dataMin, dataMax]) => {
                  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
                    return [dataMin, dataMax];
                  }
                  const span = Math.max(dataMax - dataMin, decimals === 2 ? 0.025 : 0.25);
                  const pad = span * 0.08;
                  return [dataMin - pad, dataMax + pad];
                }}
                tickFormatter={(v: number) => v.toFixed(decimals)}
              />
              <Tooltip
                contentStyle={{ background: '#0b1220', border: '1px solid #334155', borderRadius: 8 }}
                labelFormatter={(t) => formatStationTime(Number(t), s.tz, { timeStyle: 'medium' })}
                formatter={(v: unknown, name: unknown) => {
                  if (name === '_fill') return null;
                  return [
                    typeof v === 'number' ? v.toFixed(decimals) : String(v),
                    name === 'avg' ? `Avg ${unit}` : unit,
                  ];
                }}
              />
              <Area
                type="linear"
                dataKey="v"
                name="_fill"
                stroke="none"
                fill="url(#pressureFill)"
                connectNulls={false}
                isAnimationActive={false}
                legendType="none"
              />
              <Line
                type="linear"
                dataKey="avg"
                name="avg"
                stroke={colors.average}
                strokeWidth={2.15}
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Line
                type="linear"
                dataKey="v"
                name="v"
                stroke={colors.line}
                strokeWidth={1.45}
                dot={false}
                activeDot={{ r: 3.5, fill: colors.line, stroke: '#04111f', strokeWidth: 1 }}
                connectNulls={false}
                isAnimationActive={false}
                strokeLinecap="round"
                strokeLinejoin="miter"
              />
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
