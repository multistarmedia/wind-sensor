import { useEffect, useRef, useState } from 'react';
import { formatStationTime } from '../../../../shared/time';
import { thermalColorF } from '../../../../shared/thermo';
import type { TempPoint } from '../../lib/tempSeries';

export function TemperatureChart({
  points,
  tz,
  unitIsF,
  showBadges,
  showDew,
  showFeels,
  onCursor,
}: {
  points: TempPoint[];
  tz: string;
  unitIsF: boolean;
  showBadges: boolean;
  showDew: boolean;
  showFeels: boolean;
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
      const padR = 36;
      const padT = 18;
      const padB = 28;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const t0 = points[0]!.t;
      const t1 = points[points.length - 1]!.t;
      const span = Math.max(1, t1 - t0);

      let yMin = Math.min(...vals);
      let yMax = Math.max(...vals);
      const pad = Math.max(2, (yMax - yMin) * 0.12);
      yMin -= pad;
      yMax += pad;
      if (yMax - yMin < 4) {
        yMin -= 2;
        yMax += 2;
      }

      const xAt = (t: number) => padL + ((t - t0) / span) * plotW;
      const yAt = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
      const toF = (v: number) => (unitIsF ? v : (v * 9) / 5 + 32);

      // Grid + Y labels
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.fillStyle = '#64748b';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      for (let i = 0; i < 3; i++) {
        const v = yMin + ((yMax - yMin) * (i + 1)) / 4;
        const y = yAt(v);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
        ctx.fillText(`${Math.round(v)}°`, padL + plotW + 6, y + 3);
      }

      // Build smooth-ish polyline (Catmull-Rom-ish sampling of available points)
      const main = points.filter((p) => p.temp != null) as (TempPoint & { temp: number })[];
      const pathPts = main.map((p) => ({ x: xAt(p.t), y: yAt(p.temp), v: p.temp, t: p.t }));

      // Fill under curve
      if (pathPts.length > 1) {
        const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        grad.addColorStop(0, 'rgba(56, 232, 255, 0.18)');
        grad.addColorStop(1, 'rgba(56, 232, 255, 0.01)');
        ctx.beginPath();
        ctx.moveTo(pathPts[0]!.x, padT + plotH);
        for (const p of pathPts) ctx.lineTo(p.x, p.y);
        ctx.lineTo(pathPts[pathPts.length - 1]!.x, padT + plotH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Thermal stroke in segments
      for (let i = 1; i < pathPts.length; i++) {
        const a = pathPts[i - 1]!;
        const b = pathPts[i]!;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = thermalColorF(toF((a.v + b.v) / 2), 1);
        ctx.lineWidth = 2.6;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      const drawOverlay = (key: 'dew' | 'feels', color: string, dash: number[]) => {
        const pts = points.filter((p) => p[key] != null) as (TempPoint & { [K in typeof key]: number })[];
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.setLineDash(dash);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        pts.forEach((p, i) => {
          const x = xAt(p.t);
          const y = yAt(p[key]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
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
        drawBadge(ctx, hi.x, hi.y, `H: ${Math.round(hi.v)}°`, '#ff9d3b', true, padL, padL + plotW);
        drawBadge(ctx, lo.x, lo.y, `L: ${Math.round(lo.v)}°`, '#38e8ff', false, padL, padL + plotW);
      }

      // X-axis colour ticks
      const tickN = Math.min(48, Math.max(8, Math.floor(plotW / 18)));
      for (let i = 0; i <= tickN; i++) {
        const ratio = i / tickN;
        const t = t0 + ratio * span;
        // nearest value for colour
        let nearest = pathPts[0]!;
        for (const p of pathPts) {
          if (Math.abs(p.t - t) < Math.abs(nearest.t - t)) nearest = p;
        }
        const x = padL + ratio * plotW;
        ctx.strokeStyle = thermalColorF(toF(nearest.v), i % 6 === 0 ? 0.9 : 0.35);
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
      ctx.strokeStyle = 'rgba(56, 232, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cursor.x, padT);
      ctx.lineTo(cursor.x, padT + plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#38e8ff';
      ctx.shadowColor = 'rgba(56, 232, 255, 0.7)';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(cursor.v)}°`, cursor.x, Math.max(padT + 10, cursor.y - 12));

      const matched = main.find((p) => p.t === cursor.t) ?? main[main.length - 1] ?? null;
      onCursorRef.current(matched);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [points, tz, unitIsF, showBadges, showDew, showFeels, hover]);

  const onMove = (clientX: number) => {
    const canvas = ref.current;
    if (!canvas || points.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const padL = 8;
    const padR = 36;
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
