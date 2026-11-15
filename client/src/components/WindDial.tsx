// Live wind dial: Beaufort-coloured wind rose underneath, fading trail of recent readings on the rim,
// and a needle that glides between 1-second readings while the previous position fades out.
// The glide is display-only animation between two real readings; no values are invented.

import { memo, useEffect, useMemo, useRef } from 'react';
import type { WindPoint, WindRoseResponse } from '../../../shared/api';
import type { DisplayUnits } from '../../../shared/units';
import { WIND_DECIMALS, msToDisplay } from '../../../shared/units';
import { CALM_THRESHOLD_MS, compassPoint, isCalm } from '../../../shared/wind';
import {
  bandColor, DEFAULT_MAX_SPEED_MS, PALETTE_CLASSIC, paletteGradientCss, scaleTickLabels, windSpeedColor,
} from '../../../shared/windColors';
import { usePrefersReducedMotion } from '../lib/hooks';

/** @deprecated Prefer windSpeedColor with an explicit palette — kept for older call sites. */
export const FORCE_COLORS = PALETTE_CLASSIC;

export function forceColor(speedMs: number, palette: readonly string[] = PALETTE_CLASSIC, maxSpeedMs = DEFAULT_MAX_SPEED_MS) {
  return windSpeedColor(speedMs, palette, maxSpeedMs);
}

const C = 200;
const R_OUTER = 176;
const R_ROSE = 150;
const R_INNER = 46;
const TRAIL_MS = 60_000;
const GHOSTS = 4;
/** Fixed needle/stream colour — deep aquamarine blue (not speed-scaled). */
const NEEDLE_AQUA = '#067A96';

const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)] as const;
};

function wedge(centerDeg: number, halfWidth: number, r0: number, r1: number) {
  const [x0, y0] = pt(centerDeg - halfWidth, r0);
  const [x1, y1] = pt(centerDeg - halfWidth, r1);
  const [x2, y2] = pt(centerDeg + halfWidth, r1);
  const [x3, y3] = pt(centerDeg + halfWidth, r0);
  return `M${x0},${y0} L${x1},${y1} A${r1},${r1} 0 0 1 ${x2},${y2} L${x3},${y3} A${r0},${r0} 0 0 0 ${x0},${y0} Z`;
}

function shortestDelta(from: number, to: number) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Vertical sine shaft from rim (y0) toward hub (y1), in needle-local coords. */
function wavyShaft(cx: number, y0: number, y1: number, amp: number, cycles: number, phase = 0, steps = 40): string {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = y0 + (y1 - y0) * t;
    const x = cx + Math.sin(t * cycles * Math.PI * 2 + phase) * amp;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return d.trim();
}

const SHAFT_Y0 = C - R_OUTER + 14;
const SHAFT_Y1 = C - R_INNER - 18;

const WAVE_STREAMS = [
  { amp: 5.5, cycles: 2.6, phase0: 0, width: 3.2, opacity: 0.9 },
  { amp: 7, cycles: 2.85, phase0: 2.1, width: 2.2, opacity: 0.55 },
  { amp: 4.2, cycles: 3.1, phase0: 4.0, width: 1.8, opacity: 0.45 },
] as const;

/**
 * Wave-phase radians per second. Negative so crests travel rim → hub
 * (wind comes from the outer rim toward the centre).
 */
const WAVE_PHASE_RATE = -1.35;

/** Module-level phase clock — survives calm, new readings, and React remounts of the shaft. */
let waveSharedPhase = 0;
let waveSharedRaf = 0;
let waveSharedLast = 0;
const waveListeners = new Set<(phase: number) => void>();

function ensureWaveClock() {
  if (waveSharedRaf) return;
  waveSharedLast = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - waveSharedLast) / 1000);
    waveSharedLast = now;
    waveSharedPhase += dt * WAVE_PHASE_RATE;
    for (const fn of waveListeners) fn(waveSharedPhase);
    waveSharedRaf = requestAnimationFrame(tick);
  };
  waveSharedRaf = requestAnimationFrame(tick);
}

function releaseWaveClock() {
  if (waveListeners.size === 0 && waveSharedRaf) {
    cancelAnimationFrame(waveSharedRaf);
    waveSharedRaf = 0;
  }
}

function subscribeWaveClock(fn: (phase: number) => void) {
  waveListeners.add(fn);
  fn(waveSharedPhase);
  ensureWaveClock();
  return () => {
    waveListeners.delete(fn);
    releaseWaveClock();
  };
}

/**
 * Solid wavy streams. Live shafts subscribe to the shared phase clock (independent of
 * readings / calm). Ghosts are a frozen snapshot only.
 */
const WindShaftWaves = memo(function WindShaftWaves({
  color,
  ghost = false,
}: {
  color: string;
  ghost?: boolean;
}) {
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  const streams = ghost
    ? WAVE_STREAMS.map((s) => ({ ...s, width: s.width * 0.7, opacity: s.opacity * 0.6 }))
    : WAVE_STREAMS;

  const paint = (phase: number) => {
    for (let i = 0; i < streams.length; i++) {
      const el = pathRefs.current[i];
      const s = streams[i];
      if (!el || !s) continue;
      el.setAttribute('d', wavyShaft(C, SHAFT_Y0, SHAFT_Y1, s.amp, s.cycles, s.phase0 + phase));
    }
  };

  useEffect(() => {
    // Ghosts: one static frame. Live: stay on the shared clock for the whole mount life.
    if (ghost) {
      paint(waveSharedPhase);
      return;
    }
    return subscribeWaveClock(paint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghost]);

  useEffect(() => {
    for (const el of pathRefs.current) el?.setAttribute('stroke', color);
  }, [color]);

  return (
    <g className="wind-shaft" filter={ghost ? undefined : 'url(#glow)'}>
      {streams.map((s, i) => (
        <path
          key={i}
          ref={(el) => { pathRefs.current[i] = el; }}
          fill="none"
          stroke={color}
          strokeWidth={s.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={s.opacity}
        />
      ))}
    </g>
  );
});

interface Props {
  latest: WindPoint | null;
  trail: WindPoint[];
  rose: WindRoseResponse | null;
  units: DisplayUnits;
  stale: boolean;
  intervalMs: number;
  /** Independent colour palette. */
  palette?: readonly string[];
  /** Speed (m/s) that maps to the top colour; stronger winds reuse it. */
  maxSpeedMs?: number;
}

export function WindDial({
  latest, trail, rose, units, stale, intervalMs: _intervalMs,
  palette = PALETTE_CLASSIC, maxSpeedMs = DEFAULT_MAX_SPEED_MS,
}: Props) {
  const reduced = usePrefersReducedMotion();
  const needleRef = useRef<SVGGElement>(null);
  const speedRef = useRef<SVGTextElement>(null);
  const anim = useRef({
    angle: latest?.wd ?? 0,
    speed: latest?.ws ?? 0,
    targetAngle: latest?.wd ?? 0,
    targetSpeed: latest?.ws ?? 0,
  });
  const latestRef = useRef(latest);
  const calmRef = useRef(true);
  const unitsRef = useRef(units);
  const decimalsRef = useRef(WIND_DECIMALS[units.wind]);

  const calm = latest ? isCalm(latest.ws) : true;
  const decimals = WIND_DECIMALS[units.wind];
  latestRef.current = latest;
  calmRef.current = calm;
  unitsRef.current = units;
  decimalsRef.current = decimals;

  // New reading only retargets the chase — never stops or restarts the motion clock.
  useEffect(() => {
    if (!latest) return;
    const a = anim.current;
    a.angle = ((a.angle % 360) + 360) % 360;
    a.targetAngle = a.angle + shortestDelta(a.angle, latest.wd);
    a.targetSpeed = latest.ws;
    if (reduced) {
      a.angle = latest.wd;
      a.speed = latest.ws;
      a.targetAngle = latest.wd;
      needleRef.current?.setAttribute('transform', `rotate(${a.angle} ${C} ${C})`);
      if (speedRef.current) {
        speedRef.current.textContent = msToDisplay(a.speed, units.wind).toFixed(decimals);
      }
    }
  }, [latest?.t, latest?.wd, latest?.ws, reduced, units.wind, decimals]);

  // Persistent soft-chase loop: keeps easing forever so there is no pause between samples.
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    /** Larger = softer / slower catch-up toward each new reading. */
    const tau = 1.1;
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const a = anim.current;
      if (latestRef.current && !calmRef.current) {
        const k = 1 - Math.exp(-dt / tau);
        a.angle += (a.targetAngle - a.angle) * k;
        a.speed += (a.targetSpeed - a.speed) * k;
        if (Math.abs(a.targetAngle - a.angle) < 0.02) {
          a.angle = ((a.targetAngle % 360) + 360) % 360;
          a.targetAngle = a.angle;
        }
        needleRef.current?.setAttribute('transform', `rotate(${a.angle} ${C} ${C})`);
        if (speedRef.current) {
          speedRef.current.textContent = msToDisplay(a.speed, unitsRef.current.wind).toFixed(decimalsRef.current);
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const petals = useMemo(() => {
    if (!rose || rose.total === 0) return { paths: [] as { d: string; color: string }[], max: 0 };
    const sectorTotals = rose.counts.map((s) => s.reduce((a, b) => a + b, 0));
    const max = Math.max(...sectorTotals);
    if (max === 0) return { paths: [], max: 0 };
    // 16 sectors × 22.5°. Keep ~25% of the old inter-bar gap (was 4.5° → ~1.1°).
    const halfWidth = (22.5 - 4.5 * 0.25) / 2;
    const paths: { d: string; color: string }[] = [];
    rose.counts.forEach((bins, i) => {
      let cum = 0;
      bins.forEach((n, f) => {
        if (!n) return;
        const r0 = R_INNER + (cum / max) * (R_ROSE - R_INNER);
        cum += n;
        const r1 = R_INNER + (cum / max) * (R_ROSE - R_INNER);
        paths.push({ d: wedge(i * 22.5, halfWidth, r0, r1), color: bandColor(f, palette, maxSpeedMs) });
      });
    });
    return { paths, max: max / rose.total };
  }, [rose, palette, maxSpeedMs]);

  const now = latest?.t ?? Date.now();
  const trailDots = trail.filter((p) => now - p.t <= TRAIL_MS && !isCalm(p.ws));
  const ghosts = trail.slice(-(GHOSTS + 1), -1).filter((p) => !isCalm(p.ws));

  const label = latest
    ? calm
      ? `Calm (below ${msToDisplay(CALM_THRESHOLD_MS, units.wind).toFixed(1)} ${units.wind})`
      : `Wind from ${compassPoint(latest.wd)} · ${Math.round(latest.wd)}°`
    : 'No reading yet';

  return (
    <svg className={`wind-dial${stale ? ' is-stale' : ''}`} viewBox="0 0 400 400" role="img" aria-label={latest ? `${label}, ${msToDisplay(latest.ws, units.wind).toFixed(decimals)} ${units.wind}` : label}>
      <defs>
        <radialGradient id="dialBg" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#13213b" />
          <stop offset="100%" stopColor="#070d1a" />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <circle cx={C} cy={C} r={R_OUTER + 18} fill="url(#dialBg)" stroke="#1e293b" strokeWidth="2" />
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={C} cy={C} r={R_INNER + f * (R_ROSE - R_INNER)} fill="none" stroke="#1e3354" strokeDasharray="2 4" />
      ))}
      {Array.from({ length: 16 }, (_, i) => {
        const [x, y] = pt(i * 22.5, R_ROSE);
        const [x0, y0] = pt(i * 22.5, R_INNER);
        return <line key={i} x1={x0} y1={y0} x2={x} y2={y} stroke="#1a2a44" strokeWidth={0.35} />;
      })}

      <g className="rose-petals">
        {petals.paths.map((p, i) => <path key={i} d={p.d} fill={p.color} fillOpacity={0.88} stroke="#0a1220" strokeWidth="0.25" />)}
      </g>
      {petals.max > 0 && (
        <text x={C + 4} y={C - R_ROSE + 12} className="dial-small" fill="#5b7299">{Math.round(petals.max * 100)}%</text>
      )}

      {Array.from({ length: 72 }, (_, i) => {
        const deg = i * 5;
        const major = deg % 45 === 0;
        const [x0, y0] = pt(deg, R_OUTER - (major ? 10 : deg % 15 === 0 ? 6 : 3));
        const [x1, y1] = pt(deg, R_OUTER);
        return <line key={deg} x1={x0} y1={y0} x2={x1} y2={y1} stroke={major ? '#94a3b8' : '#334155'} strokeWidth={major ? 2 : 1} />;
      })}
      {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((n, i) => {
        const [x, y] = pt(i * 45, R_OUTER + 10);
        return <text key={n} x={x} y={y} className={i % 2 ? 'dial-label' : 'dial-label dial-cardinal'} textAnchor="middle" dominantBaseline="central">{n}</text>;
      })}

      <g className="trail">
        {trailDots.map((p) => {
          const age = (now - p.t) / TRAIL_MS;
          const [x, y] = pt(p.wd, R_OUTER - 18);
          return <circle key={p.t} cx={x} cy={y} r={3 + 3 * (1 - age)} fill={NEEDLE_AQUA} opacity={Math.max(0.05, 0.9 * (1 - age))} />;
        })}
      </g>

      {!calm && !reduced && ghosts.map((p, i) => (
        <g key={p.t} transform={`rotate(${p.wd} ${C} ${C})`} opacity={0.08 + (0.22 * (i + 1)) / GHOSTS} className="ghost">
          <WindShaftWaves color={NEEDLE_AQUA} ghost />
        </g>
      ))}

      {/* Needle + waves stay mounted while hidden in calm so the shared wave clock never drops. */}
      <g ref={needleRef} transform={`rotate(${anim.current.angle} ${C} ${C})`} style={{ opacity: calm || !latest || reduced ? 0 : 1, transition: 'opacity 600ms' }}>
        <WindShaftWaves color={NEEDLE_AQUA} />
        <path
          d={`M${C},${C - R_INNER + 2} L${C + 11},${C - R_INNER - 18} L${C - 11},${C - R_INNER - 18} Z`}
          fill="#070d1a"
          stroke={NEEDLE_AQUA}
          strokeWidth="3"
          strokeLinejoin="round"
          filter="url(#glow)"
        />
      </g>

      <circle cx={C} cy={C} r={R_INNER - 4} fill="#070d1a" stroke="#1e3354" />
      {latest || trail.length ? (
        <>
          <text ref={speedRef} x={C} y={C + 5} textAnchor="middle" className="dial-speed">
            {latest ? msToDisplay(latest.ws, units.wind).toFixed(decimals) : '—'}
          </text>
          <text x={C} y={C + 29} textAnchor="middle" className="dial-unit">{units.wind}</text>
        </>
      ) : (
        <>
          <text x={C} y={C - 4} textAnchor="middle" className="dial-unit">Calm</text>
          <text x={C} y={C + 16} textAnchor="middle" className="dial-unit">
            {rose && rose.total ? `${Math.round((rose.calm / rose.total) * 100)}%` : '—'}
          </text>
        </>
      )}
    </svg>
  );
}

export function ForceLegend({
  units,
  palette = PALETTE_CLASSIC,
  maxSpeedMs = DEFAULT_MAX_SPEED_MS,
}: {
  units: DisplayUnits;
  palette?: readonly string[];
  maxSpeedMs?: number;
}) {
  const ticks = scaleTickLabels(maxSpeedMs, units.wind, 5);
  return (
    <div className="force-legend force-legend-scale" aria-label="Wind colour scale">
      <div className="force-legend-bar" style={{ background: paletteGradientCss(palette) }} />
      <div className="force-legend-ticks">
        {ticks.map((tick) => (
          <span key={tick.t} style={{ left: `${tick.t * 100}%` }}>{tick.label}</span>
        ))}
      </div>
      <span className="force-unit">{units.wind}</span>
    </div>
  );
}
