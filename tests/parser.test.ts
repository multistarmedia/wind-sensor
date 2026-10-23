import { describe, expect, it } from 'vitest';
import { LineFramer } from '../shared/framer';
import { computeChecksum, parseRecord, withChecksum } from '../shared/parser';
import { SUGGESTED_PROFILE, type ProfileSettings } from '../shared/profile';
import { meanDirection, compassPoint, beaufortForce, sectorIndex } from '../shared/wind';
import { startOfZonedDay } from '../shared/time';
import { bucketSizeMs } from '../shared/buckets';

const enc = (s: string) => new TextEncoder().encode(s);
const metric: ProfileSettings = { ...SUGGESTED_PROFILE, unitsConfirmed: true };

const CALCULATED_FIXTURE = '000.6,272,+023.6,022,0974.3,000.00,0000,12.7,U0,*02355';
const MANUAL_PRINTED = '000.6,272,+023.6,022,0974.3,000.00,0000,12.7,U0,*02257';

describe('checksum (acceptance 5)', () => {
  it('validates the calculated *02355 fixture', () => {
    const r = parseRecord(CALCULATED_FIXTURE, metric);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.measurements.windSpeedMs).toBeCloseTo(0.6);
      expect(r.measurements.windDirDeg).toBe(272);
      expect(r.measurements.airTempC).toBeCloseTo(23.6);
      expect(r.measurements.rhPct).toBe(22);
      expect(r.measurements.pressureHpa).toBeCloseTo(974.3);
      expect(r.measurements.supplyV).toBeCloseTo(12.7);
      expect(r.config).toBe('U0');
    }
  });

  it("fails the manual's printed *02257 example under the stated rule", () => {
    const r = parseRecord(MANUAL_PRINTED, metric);
    expect(r).toMatchObject({ ok: false, code: 'checksum_mismatch', checksum: { reported: 2257, calculated: 2355 } });
  });

  it('includes the trailing comma and excludes *, digits and CR/LF', () => {
    expect(computeChecksum('A,')).toBe(65 + 44);
  });

  it('accepts leading zeros and 4-digit checksums numerically', () => {
    const payload = '000.6,272,+023.6,022,0974.3,000.00,0000,12.7,U0,';
    expect(parseRecord(`${payload}*2355`, metric).ok).toBe(true);
    expect(parseRecord(`${payload}*002355`, metric).ok).toBe(false); // more than 5 digits is malformed
  });
});

describe('framing (acceptance 3, 4)', () => {
  it('reassembles a line split across arbitrary chunks into one record', () => {
    const f = new LineFramer();
    const bytes = enc(`${CALCULATED_FIXTURE}\r\n`);
    const events = [];
    for (let i = 0; i < bytes.length; i += 3) events.push(...f.push(bytes.slice(i, i + 3)));
    expect(events).toEqual([{ type: 'line', raw: CALCULATED_FIXTURE }]);
  });

  it('processes every line in one chunk, including identical successive lines', () => {
    const f = new LineFramer();
    const events = f.push(enc(`${CALCULATED_FIXTURE}\r\n${CALCULATED_FIXTURE}\r\n${CALCULATED_FIXTURE}\r\n`));
    expect(events.filter((e) => e.type === 'line')).toHaveLength(3);
  });

  it('handles CR and LF split across chunks and blank lines without duplicates', () => {
    const f = new LineFramer();
    const a = f.push(enc(`${CALCULATED_FIXTURE}\r`));
    const b = f.push(enc('\n\r\n\r\n'));
    const c = f.push(enc(`${CALCULATED_FIXTURE}\r\n`));
    expect([...a, ...b, ...c]).toHaveLength(2);
  });

  it('reports an oversized line once, discards to the next delimiter, then recovers', () => {
    const f = new LineFramer();
    const events = [...f.push(enc('9'.repeat(2000))), ...f.push(enc('9'.repeat(2000))), ...f.push(enc(`junk\r\n${CALCULATED_FIXTURE}\r\n`))];
    expect(events.map((e) => e.type)).toEqual(['overflow', 'line']);
    expect(f.pendingBytes).toBe(0);
  });
});

describe('layouts (acceptance 6, 7)', () => {
  it('preserves whitespace for legacy checksum verification', () => {
    const legacy: ProfileSettings = { ...metric, format: 'legacy', includesVoltage: false };
    const line = withChecksum('002.6, 219, +020.8, 042, 1013.2, ', 4);
    const r = parseRecord(line, legacy);
    expect(r.ok).toBe(true);
    // Removing the spaces changes the sum, so a whitespace-normalised copy must fail.
    const squashed = line.replace(/, /g, ',');
    expect(parseRecord(squashed, legacy)).toMatchObject({ ok: false, code: 'checksum_mismatch' });
  });

  it('rejects the field count when voltage output is off but the profile expects it', () => {
    const line = withChecksum('000.0,000,+024.5,045,0970.5,000.00,0000,M0,');
    expect(parseRecord(line, metric)).toMatchObject({ ok: false, code: 'wrong_layout' });
    expect(parseRecord(line, { ...metric, includesVoltage: false }).ok).toBe(true);
  });

  it('reads the compass field when CV is on', () => {
    const line = withChecksum('000.0,000,+024.5,045,0970.5,000.00, 0000,12.0,240,M0,');
    const r = parseRecord(line, { ...metric, includesCompass: true });
    expect(r.ok && r.measurements.compassDeg).toBe(240);
    expect(parseRecord(line, metric)).toMatchObject({ ok: false, code: 'wrong_layout' });
  });

  it('never turns an empty field into zero', () => {
    const line = withChecksum('000.6,,+023.6,022,0974.3,000.00,0000,12.7,U0,');
    expect(parseRecord(line, metric)).toMatchObject({ ok: false, code: 'invalid_number' });
  });

  it('rejects non-ASCII bytes with a diagnostic', () => {
    expect(parseRecord('00ÿ.6,272', metric)).toMatchObject({ ok: false, code: 'non_ascii' });
  });
});

describe('units (acceptance 8, 9)', () => {
  it('normalises confirmed imperial input to canonical units', () => {
    const imperial: ProfileSettings = { ...metric, windUnit: 'mph', tempUnit: 'F', pressureUnit: 'inHg', rainUnit: 'in', rainGaugeInstalled: true };
    const r = parseRecord(withChecksum('010.0,090,+032.0,050,029.92,000.10,0000,12.0,M1,'), imperial);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.measurements.windSpeedMs).toBeCloseTo(4.4704, 4);
      expect(r.measurements.airTempC).toBeCloseTo(0, 6);
      expect(r.measurements.pressureHpa).toBeCloseTo(1013.2, 0);
      expect(r.measurements.rainMm).toBeCloseTo(2.54, 4);
    }
  });

  it('keeps rain and solar null when not installed', () => {
    const r = parseRecord(CALCULATED_FIXTURE, metric);
    expect(r.ok && r.measurements.rainMm).toBeNull();
    expect(r.ok && r.measurements.solarWm2).toBeNull();
  });

  it('rejects readings outside documented bounds (e.g. Fahrenheit read as Celsius)', () => {
    const r = parseRecord(withChecksum('000.6,272,+085.0,022,0974.3,000.00,0000,12.7,U0,'), metric);
    expect(r).toMatchObject({ ok: false, code: 'out_of_range' });
  });
});

describe('wind maths (acceptance 10)', () => {
  it('averages 359° and 1° to north, not south', () => {
    const d = meanDirection([{ dir: 359, speed: 5 }, { dir: 1, speed: 5 }])!;
    expect(Math.min(d, 360 - d)).toBeLessThan(0.001);
  });
  it('reports cancelling vectors as unavailable', () => {
    expect(meanDirection([{ dir: 0, speed: 5 }, { dir: 180, speed: 5 }])).toBeNull();
  });
  it('names compass points and Beaufort forces', () => {
    expect(compassPoint(272)).toBe('W');
    expect(compassPoint(359)).toBe('N');
    expect(beaufortForce(0.1)).toBe(0);
    expect(beaufortForce(5.5)).toBe(4);
    expect(beaufortForce(80)).toBe(12);
    expect(sectorIndex(350)).toBe(0);
    expect(sectorIndex(12)).toBe(1);
  });
});

describe('station time (acceptance 18)', () => {
  it('finds local midnight across a DST change', () => {
    // 2026-03-08 is the US spring-forward day; midnight is still in PST (UTC−8).
    const noon = Date.UTC(2026, 2, 8, 20, 0);
    expect(new Date(startOfZonedDay('America/Los_Angeles', noon)).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    // The following day starts in PDT (UTC−7), so the DST day is 23 hours long.
    const next = Date.UTC(2026, 2, 9, 20, 0);
    expect(new Date(startOfZonedDay('America/Los_Angeles', next)).toISOString()).toBe('2026-03-09T07:00:00.000Z');
    // Fall back: 2026-11-01 is 25 hours long.
    expect(new Date(startOfZonedDay('America/Los_Angeles', Date.UTC(2026, 10, 2, 0, 30))).toISOString()).toBe('2026-11-01T07:00:00.000Z');
  });
  it('handles zones where DST skips midnight', () => {
    // America/Santiago springs forward at 24:00 on 2026-09-05, so 2026-09-06 begins at 01:00 local.
    const t = startOfZonedDay('America/Santiago', Date.UTC(2026, 8, 6, 18, 0));
    expect(new Date(t).toISOString()).toBe('2026-09-06T04:00:00.000Z');
  });
});

describe('history buckets', () => {
  it('keeps every supported range near 600–1000 points', () => {
    for (const h of [1, 24, 24 * 7, 24 * 31]) {
      const ms = h * 3600_000;
      const n = ms / bucketSizeMs(ms);
      expect(n).toBeGreaterThanOrEqual(600);
      expect(n).toBeLessThanOrEqual(1000);
    }
  });
});
