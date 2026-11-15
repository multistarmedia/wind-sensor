import { describe, expect, it } from 'vitest';
import { BEAUFORT_EDGES_MS, CALM_THRESHOLD_MS } from '../shared/wind';
import {
  bandColor, clampMaxSpeedMs, DEFAULT_MAX_SPEED_MS, displayToMs, paletteColorAt,
  PALETTE_CLASSIC, PALETTE_WARM, speedScaleT, windSpeedColor,
} from '../shared/windColors';

describe('wind colour scale', () => {
  it('maps continuously from calm to maxSpeedMs, clamping above', () => {
    const max = 10; // m/s
    expect(speedScaleT(CALM_THRESHOLD_MS, max)).toBe(0);
    expect(speedScaleT(max, max)).toBe(1);
    expect(speedScaleT(max + 20, max)).toBe(1);
    expect(speedScaleT((CALM_THRESHOLD_MS + max) / 2, max)).toBeCloseTo(0.5, 5);
  });

  it('reuses the top colour for any reading at or above maxSpeedMs', () => {
    const max = displayToMs(25, 'mph');
    const top = paletteColorAt(1, PALETTE_CLASSIC);
    expect(windSpeedColor(max, PALETTE_CLASSIC, max)).toBe(top);
    expect(windSpeedColor(max * 2, PALETTE_CLASSIC, max)).toBe(top);
    expect(windSpeedColor(40, PALETTE_CLASSIC, max)).toBe(top);
  });

  it('interpolates mid-scale colours between palette stops', () => {
    const mid = windSpeedColor(5, PALETTE_CLASSIC, 10);
    expect(mid).toMatch(/^#[0-9a-f]{6}$/i);
    expect(mid).not.toBe(PALETTE_CLASSIC[0]);
    expect(mid).not.toBe(paletteColorAt(1, PALETTE_CLASSIC));
  });

  it('keeps palettes independent of the speed max', () => {
    const ms = 8;
    const max = 20;
    expect(windSpeedColor(ms, PALETTE_CLASSIC, max)).not.toBe(windSpeedColor(ms, PALETTE_WARM, max));
  });

  it('keeps calm on its own grey, outside the ramp', () => {
    expect(windSpeedColor(0.1, PALETTE_CLASSIC, 15)).toBe('#94a3b8');
  });

  it('colours rose bins from the continuous scale at each Beaufort edge', () => {
    const max = BEAUFORT_EDGES_MS[3]!; // ~12 mph edge
    const f3 = bandColor(3, PALETTE_CLASSIC, max);
    const f8 = bandColor(8, PALETTE_CLASSIC, max);
    expect(f3).toBe(paletteColorAt(1, PALETTE_CLASSIC));
    expect(f8).toBe(f3); // stronger bins reuse top once past max
  });

  it('clamps absurd max speeds into a usable window', () => {
    expect(clampMaxSpeedMs(0)).toBeGreaterThan(CALM_THRESHOLD_MS);
    expect(clampMaxSpeedMs(999)).toBe(60);
    expect(clampMaxSpeedMs(DEFAULT_MAX_SPEED_MS)).toBe(DEFAULT_MAX_SPEED_MS);
  });
});
