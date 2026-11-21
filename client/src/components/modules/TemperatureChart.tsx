import { useEffect, useRef, useState } from 'react';
import { formatStationTime } from '../../../../shared/time';
import type { SchemeChartColors } from '../../../../shared/windColors';
import type { TempPoint } from '../../lib/tempSeries';

export function TemperatureChart({
  points,
  tz,
  unitIsF,
  showBadges,
  showDew,
  showFeels,
  colors,
  onCursor,
}: {
  points: TempPoint[];
  tz: string;
  unitIsF: boolean;
  showBadges: boolean;
  showDew: boolean;
  showFeels: boolean;
  colors: SchemeChartColors;
  onCursor: (p: TempPoint | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const cs = getComputedStyle(parent);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const w = Math.max(0, parent.clientWidth - padX);
      const h = Math.max(0, parent.clientHeight - padY);
      if (w < 10 || h < 10) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const vals = points.map((p) => p.temp).filter((v): v is number => v != null);
      if (vals.length < 2) {
        ctx.fillStyle = '#64748b';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText('No temperature readings in this window', 12, h / 2);
        return;
      }

      const padL = 8;
      const padR = 40;
      const padT = 18;
      const padB = 28;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const t0 = points[0]!.t;
      const t1 = points[points.length - 1]!.t;
      const span = Math.max(1, t1 - t0);

      let yMin = Math.min(...vals);
      let yMax = Math.max(...vals);
      const dataSpan = Math.max(yMax - yMin, unitIsF ? 0.6 : 0.35);
      const pad = dataSpan * 0.07;
      yMin -= pad;
      yMax += pad;

      const xAt = (t: number) => padL + ((t - t0) / span) * plotW;
      const yAt = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
      const decimals = dataSpan < 4 ? 1 : 0;

      // Grid + Y labels (tighter domain → more readable ticks)
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.fillStyle = '#64748b';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      const tickCount = 5;
      for (let i = 0; i < tickCount; i++) {
        const v = yMin + ((yMax - yMin) * (i + 1)) / (tickCount + 1);
        const y = yAt(v);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
        ctx.fillText(`${v.toFixed(decimals)}°`, padL + plotW + 6, y + 3);
      }

      const main = points.filter((p) => p.temp != null) as (TempPoint & { temp: number })[];
      const pathPts = main.map((p) => ({ x: xAt(p.t), y: yAt(p.temp), v: p.temp, t: p.t }));
      const avgPts = main
        .filter((p) => p.avg != null)
        .map((p) => ({ x: xAt(p.t), y: yAt(p.avg!) }));

      // Fill under detail curve
      if (pathPts.length > 1) {
        const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        grad.addColorStop(0, hexAlpha(colors.fill, 0.28));
        grad.addColorStop(0.55, hexAlpha(colors.fill, 0.1));
        grad.addColorStop(1, hexAlpha(colors.fill, 0.02));
        ctx.beginPath();
        ctx.moveTo(pathPts[0]!.x, padT + plotH);
        strokeMonotone(ctx, pathPts, true);
        ctx.lineTo(pathPts[pathPts.length - 1]!.x, padT + plotH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Lighter average mid-spine (same scheme pairing as baro)
      if (avgPts.length > 1) {
        ctx.beginPath();
        strokeMonotone(ctx, avgPts, false);
        ctx.strokeStyle = colors.average;
        ctx.lineWidth = 2.15;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Darker primary detail stroke (monotone cubic — smooth, no overshoot)
      if (pathPts.length > 1) {
        ctx.beginPath();
        strokeMonotone(ctx, pathPts, false);
        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 1.45;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      const drawOverlay = (key: 'dew' | 'feels', color: string, dash: number[]) => {
        const pts = points.filter((p) => p[key] != null) as (TempPoint & { [K in typeof key]: number })[];
        if (pts.length < 2) return;
        const overlay = pts.map((p) => ({ x: xAt(p.t), y: yAt(p[key]) }));
        ctx.beginPath();
        ctx.setLineDash(dash);
        strokeMonotone(ctx, overlay, false);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.55;
        ctx.stroke();
        ctx.setLineDash([]);
      };
      if (showDew) drawOverlay('dew', 'rgba(96, 165, 250, 0.75)', [4, 5]);
      if (showFeels) drawOverlay('feels', 'rgba(251, 146, 60, 0.75)', [6, 4]);

      // Hi / Lo badges
      if (showBadges && pathPts.length) {
        let hi = pathPts[0]!;
        let lo = pathPts[0]!;
        for (const p of pathPts) {
          if (p.v > hi.v) hi = p;
          if (p.v < lo.v) lo = p;
        }
        drawBadge(ctx, hi.x, hi.y, `H: ${Math.round(hi.v)}°`, colors.line, true, padL, padL + plotW);
        drawBadge(ctx, lo.x, lo.y, `L: ${Math.round(lo.v)}°`, colors.average, false, padL, padL + plotW);
      }

      // X-axis ticks (scheme-tinted)
      const tickN = Math.min(48, Math.max(8, Math.floor(plotW / 18)));
      for (let i = 0; i <= tickN; i++) {
        const ratio = i / tickN;
        const x = padL + ratio * plotW;
        ctx.strokeStyle = hexAlpha(colors.line, i % 6 === 0 ? 0.85 : 0.3);
        ctx.beginPath();
        ctx.moveTo(x, padT + plotH + 4);
        ctx.lineTo(x, padT + plotH + (i % 6 === 0 ? 12 : 7));
        ctx.stroke();
      }
      ctx.fillStyle = '#64748b';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const labelCount = 5;
      for (let i = 0; i < labelCount; i++) {
        const t = t0 + (i / (labelCount - 1)) * span;
        const label = formatStationTime(t, tz, span > 2 * 86_400_000
          ? { month: 'short', day: 'numeric' }
          : span > 6 * 3600_000
            ? { hour: 'numeric' }
            : { hour: 'numeric', minute: '2-digit' });
        ctx.fillText(label, padL + (i / (labelCount - 1)) * plotW, h - 6);
      }

      // Cursor
      const cursorIdx = hover == null ? pathPts.length - 1 : Math.round(hover * (pathPts.length - 1));
      const cursor = pathPts[Math.min(pathPts.length - 1, Math.max(0, cursorIdx))]!;
      ctx.strokeStyle = hexAlpha(colors.line, 0.4);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cursor.x, padT);
      ctx.lineTo(cursor.x, padT + plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = colors.line;
      ctx.shadowColor = hexAlpha(colors.line, 0.65);
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${cursor.v.toFixed(decimals)}°`, cursor.x, Math.max(padT + 10, cursor.y - 12));

      // Only publish scrub time while the pointer is on the chart — live clock uses wall time otherwise.
      if (hover == null) onCursorRef.current(null);
      else {
        const matched = main.find((p) => p.t === cursor.t) ?? main[main.length - 1] ?? null;
        onCursorRef.current(matched);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [points, tz, unitIsF, showBadges, showDew, showFeels, colors, hover]);

  const onMove = (clientX: number) => {
    const canvas = ref.current;
    if (!canvas || points.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const padL = 8;
    const padR = 40;
    const plotW = rect.width - padL - padR;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - padL) / plotW));
    setHover(ratio);
  };

  return (
    <canvas
      ref={ref}
      className="temp-canvas"
      onPointerDown={(e) => { (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId); onMove(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') onMove(e.clientX); else onMove(e.clientX); }}
      onPointerLeave={() => setHover(null)}
    />
  );
}

/** Fritsch–Carlson monotone cubic Hermite — smooth path without overshoot. */
function strokeMonotone(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  continuePath: boolean,
) {
  if (pts.length === 0) return;
  if (!continuePath) ctx.moveTo(pts[0]!.x, pts[0]!.y);
  else ctx.lineTo(pts[0]!.x, pts[0]!.y);
  if (pts.length === 1) return;
  if (pts.length === 2) {
    ctx.lineTo(pts[1]!.x, pts[1]!.y);
    return;
  }

  const n = pts.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1]!.x - pts[i]!.x;
    dy[i] = pts[i + 1]!.y - pts[i]!.y;
    m[i] = dx[i] === 0 ? 0 : dy[i]! / dx[i]!;
  }
  const slopes: number[] = new Array(n);
  slopes[0] = m[0]!;
  slopes[n - 1] = m[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1]! * m[i]! <= 0) slopes[i] = 0;
    else slopes[i] = (m[i - 1]! + m[i]!) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(m[i]!) < 1e-12) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
      continue;
    }
    const a = slopes[i]! / m[i]!;
    const b = slopes[i + 1]! / m[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      slopes[i] = t * a * m[i]!;
      slopes[i + 1] = t * b * m[i]!;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const h = dx[i]!;
    ctx.bezierCurveTo(
      p0.x + h / 3,
      p0.y + (slopes[i]! * h) / 3,
      p1.x - h / 3,
      p1.y - (slopes[i + 1]! * h) / 3,
      p1.x,
      p1.y,
    );
  }
}

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  above: boolean,
  minX: number,
  maxX: number,
) {
  ctx.font = '600 10px system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  const bw = tw + 12;
  const bh = 18;
  let bx = x - bw / 2;
  bx = Math.min(maxX - bw, Math.max(minX, bx));
  const by = above ? y - bh - 10 : y + 10;
  ctx.fillStyle = 'rgba(20, 22, 28, 0.92)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  roundRect(ctx, bx, by, bw, bh, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, bx + bw / 2, by + 12);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
