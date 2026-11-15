import { describe, expect, it } from 'vitest';
import { dewPointC, feelsLikeC, thermalColorF } from '../shared/thermo';

describe('thermo', () => {
  it('computes a sensible dew point below air temperature', () => {
    const td = dewPointC(20, 50);
    expect(td).not.toBeNull();
    expect(td!).toBeLessThan(20);
    expect(td!).toBeGreaterThan(0);
  });

  it('returns null dew point for empty humidity', () => {
    expect(dewPointC(20, 0)).toBeNull();
  });

  it('applies wind chill when cold and breezy', () => {
    const feels = feelsLikeC(0, 50, 10);
    expect(feels).not.toBeNull();
    expect(feels!).toBeLessThan(0);
  });

  it('returns thermal colours', () => {
    expect(thermalColorF(55)).toMatch(/^rgba\(/);
  });
});
