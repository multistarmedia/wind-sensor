import { describe, expect, it } from 'vitest';
import { angleFor } from '../client/src/components/modules/PressureDial';

describe('pressure dial needle angle', () => {
  it('puts standard sea-level 1013 at the top centre (0°)', () => {
    expect(angleFor(1013)).toBe(0);
  });

  it('puts 1012.2 just left of centre, not past 1013', () => {
    const a = angleFor(1012.2);
    expect(a).toBeLessThan(0);
    expect(a).toBeGreaterThan(-3);
  });

  it('anchors the scale ends at ±120°', () => {
    expect(angleFor(930)).toBe(-120);
    expect(angleFor(1070)).toBe(120);
  });

  it('aligns intermediate tick labels with their marks', () => {
    expect(angleFor(970)).toBe(-60);
    expect(angleFor(1050)).toBe(60);
  });
});
