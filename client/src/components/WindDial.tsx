// Live wind dial: Beaufort-coloured wind rose underneath, fading trail of recent readings on the rim,
// and a needle that glides between 1-second readings while the previous position fades out.
// The glide is display-only animation between two real readings; no values are invented.

import { useEffect, useMemo, useRef } from 'react';
import type { WindPoint, WindRoseResponse } from '../../../shared/api';
import type { DisplayUnits } from '../../../shared/units';
import { WIND_DECIMALS, msToDisplay } from '../../../shared/units';
import { beaufortForce, BEAUFORT_NAMES, CALM_THRESHOLD_MS, compassPoint, isCalm } from '../../../shared/wind';
import { usePrefersReducedMotion } from '../lib/hooks';

export const FORCE_COLORS = [
  '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#eab308',
  '#f59e0b', '#f97316', '#ef4444', '#dc2626', '#db2777', '#a21caf',
];

export function forceColor(speedMs: number) {
  const f = beaufortForce(speedMs);
  return f === 0 ? '#94a3b8' : FORCE_COLORS[f - 1]!;
}

const C = 200;
const R_OUTER = 176;
const R_ROSE = 150;
const R_INNER = 46;
const TRAIL_MS = 60_000;
const GHOSTS = 4;

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

interface Props {
  latest: WindPoint | null;
  trail: WindPoint[];
  rose: WindRoseResponse | null;
  units: DisplayUnits;
  stale: boolean;
  intervalMs: number;
}

export function WindDial({ latest, trail, rose, units, stale, intervalMs }: Props) {
  const reduced = usePrefersReducedMotion();
  const needleRef = useRef<SVGGElement>(null);
  const speedRef = useRef<SVGTextElement>(null);
  const anim = useRef({ angle: latest?.wd ?? 0, speed: latest?.ws ?? 0, fromAngle: 0, toAngle: 0, fromSpeed: 0, toSpeed: 0, start: 0, raf: 0 });

  const calm = latest ? isCalm(latest.ws) : true;
  const decimals = WIND_DECIMALS[units.wind];

  // Glide needle and speed from the previous reading to the new one over ~one reading interval.
  useEffect(() => {
    if (!latest) return;
    const a = anim.current;
    a.fromAngle = a.angle;
    a.toAngle = a.angle + shortestDelta(a.angle, latest.wd);
    a.fromSpeed = a.speed;
    a.toSpeed = latest.ws;
    a.start = performance.now();
    const duration = reduced ? 0 : Math.min(1200, intervalMs * 0.9);
    cancelAnimationFrame(a.raf);
    const step = (now: number) => {
      const p = duration === 0 ? 1 : Math.min(1, (now - a.start) / duration);
      const e = 1 - (1 - p) ** 3; // ease-out
      a.angle = a.fromAngle + (a.toAngle - a.fromAngle) * e;
      a.speed = a.fromSpeed + (a.toSpeed - a.fromSpeed) * e;
      needleRef.current?.setAttribute('transform', `rotate(${a.angle} ${C} ${C})`);
      if (speedRef.current) speedRef.current.textContent = msToDisplay(a.speed, units.wind).toFixed(decimals);
      if (p < 1) a.raf = requestAnimationFrame(step);
      else a.angle = ((a.angle % 360) + 360) % 360;
    };
    a.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(a.raf);
  }, [latest?.t, latest?.wd, latest?.ws, reduced, intervalMs, units.wind, decimals]);

  const petals = useMemo(() => {
    if (!rose || rose.total === 0) return { paths: [] as { d: string; color: string }[], max: 0 };
    const sectorTotals = rose.counts.map((s) => s.reduce((a, b) => a + b, 0));
    const max = Math.max(...sectorTotals);
    if (max === 0) return { paths: [], max: 0 };
    const paths: { d: string; color: string }[] = [];
    rose.counts.forEach((bins, i) => {
      let cum = 0;
      bins.forEach((n, f) => {
        if (!n) return;
        const r0 = R_INNER + (cum / max) * (R_ROSE - R_INNER);
        cum += n;
        const r1 = R_INNER + (cum / max) * (R_ROSE - R_INNER);
        paths.push({ d: wedge(i * 22.5, 9, r0, r1), color: FORCE_COLORS[f]! });
      });
    });
    return { paths, max: max / rose.total };
  }, [rose]);

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
        return <line key={i} x1={x0} y1={y0} x2={x} y2={y} stroke="#15253f" />;
      })}

      <g className="rose-petals">
        {petals.paths.map((p, i) => <path key={i} d={p.d} fill={p.color} fillOpacity={0.82} stroke="#070d1a" strokeWidth="0.6" />)}
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
          return <circle key={p.t} cx={x} cy={y} r={3 + 3 * (1 - age)} fill={forceColor(p.ws)} opacity={Math.max(0.05, 0.9 * (1 - age))} />;
        })}
      </g>

      {!calm && !reduced && ghosts.map((p, i) => (
        <g key={p.t} transform={`rotate(${p.wd} ${C} ${C})`} opacity={0.08 + (0.22 * (i + 1)) / GHOSTS} className="ghost">
          <path d={`M${C},${C - R_OUTER + 22} L${C + 7},${C - R_OUTER + 44} L${C - 7},${C - R_OUTER + 44} Z`} fill={forceColor(p.ws)} />
        </g>
      ))}

      <g ref={needleRef} transform={`rotate(${anim.current.angle} ${C} ${C})`} style={{ opacity: calm || !latest ? 0 : 1, transition: 'opacity 600ms' }}>
        {/* Arrow from the rim (where the wind comes from) toward the centre (where it blows). */}
        <line x1={C} y1={C - R_OUTER + 24} x2={C} y2={C - R_INNER - 6} stroke={latest ? forceColor(latest.ws) : '#38bdf8'} strokeWidth="5" strokeLinecap="round" filter="url(#glow)" />
        <path d={`M${C},${C - R_INNER + 2} L${C + 11},${C - R_INNER - 18} L${C - 11},${C - R_INNER - 18} Z`} fill={latest ? forceColor(latest.ws) : '#38bdf8'} filter="url(#glow)" />
        <circle cx={C} cy={C - R_OUTER + 22} r="7" fill="#070d1a" stroke={latest ? forceColor(latest.ws) : '#38bdf8'} strokeWidth="3" />
      </g>

      <circle cx={C} cy={C} r={R_INNER - 4} fill="#070d1a" stroke="#1e3354" />
      {latest || trail.length ? (
        <>
          <text ref={speedRef} x={C} y={C - 2} textAnchor="middle" className="dial-speed">
            {latest ? msToDisplay(latest.ws, units.wind).toFixed(decimals) : '—'}
          </text>
          <text x={C} y={C + 22} textAnchor="middle" className="dial-unit">{units.wind}</text>
        </>
      ) : (
        <>
          <text x={C} y={C - 4} textAnchor="middle" className="dial-unit">Calm</text>
          <text x={C} y={C + 16} textAnchor="middle" className="dial-unit">
            {rose && rose.total ? `${Math.round((rose.calm / rose.total) * 100)}%` : '—'}
          </text>
        </>
      )}
      {latest && !calm && (
        <text x={C} y={C + 36} textAnchor="middle" className="dial-small" fill="#7c8db0">{BEAUFORT_NAMES[beaufortForce(latest.ws) - 1]}</text>
      )}
    </svg>
  );
}

export function ForceLegend({ units }: { units: DisplayUnits }) {
  const edges = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  return (
    <div className="force-legend" aria-label="Wind rose colour legend (Beaufort force)">
      {edges.map((lo, i) => {
        const hi = edges[i + 1];
        const a = msToDisplay(lo, units.wind).toFixed(0);
        const text = hi === undefined ? `${a}+` : `${a}–${msToDisplay(hi, units.wind).toFixed(0)}`;
        return (
          <span key={i} title={`Force ${i + 1}: ${BEAUFORT_NAMES[i]}`}>
            <i style={{ background: FORCE_COLORS[i] }} />
            {text}
          </span>
        );
      })}
      <span className="force-unit">{units.wind}</span>
    </div>
  );
}
