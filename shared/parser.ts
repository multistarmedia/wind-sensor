// AIO 2 record validation and parsing. Shared by browser and server so both reject the same lines.

import { expectedFields, FIELD_LABELS, type FieldKey, type ProfileSettings } from './profile';
import { pressureToHpa, rainToMm, tempToC, windToMs } from './units';

export const MAX_RECORD_BYTES = 512;

export type RejectCode =
  | 'empty'
  | 'record_too_long'
  | 'non_ascii'
  | 'missing_checksum'
  | 'checksum_mismatch'
  | 'wrong_layout'
  | 'invalid_number'
  | 'out_of_range';

export interface Measurements {
  windSpeedMs: number;
  windDirDeg: number;
  airTempC: number;
  rhPct: number;
  pressureHpa: number;
  /** Raw rain field converted to mm. Meaning (counter, interval, reset) is unverified. */
  rainMm: number | null;
  solarWm2: number | null;
  supplyV: number | null;
  compassDeg: number | null;
}

export interface ParsedRecord {
  ok: true;
  measurements: Measurements;
  config: string | null;
  checksum: { reported: number; calculated: number };
  fields: { key: FieldKey; text: string }[];
}

export interface RejectedRecord {
  ok: false;
  code: RejectCode;
  message: string;
  checksum?: { reported: number | null; calculated: number };
}

export type ParseResult = ParsedRecord | RejectedRecord;

/**
 * Checksum per the manual: 16-bit sum of every byte from the start of the record through the
 * character immediately before '*'. Includes spaces and a trailing comma. Excludes '*', digits, CR, LF.
 */
export function computeChecksum(payload: string): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) sum = (sum + payload.charCodeAt(i)) & 0xffff;
  return sum;
}

/** Canonical-unit bounds: manual specifications, wind widened to the owner's stated 180 mph ceiling. */
export const BOUNDS = {
  windSpeedMs: [0, 80.5],
  windDirDeg: [0, 360],
  airTempC: [-40, 60],
  rhPct: [0, 100],
  pressureHpa: [500, 1100],
  rainMm: [0, 100_000],
  solarWm2: [0, 2000],
  supplyV: [0, 40],
  compassDeg: [0, 360],
} as const satisfies Record<keyof Measurements, readonly [number, number]>;

const NUMBER = /^[+-]?\d+(\.\d+)?$/;

function reject(code: RejectCode, message: string, checksum?: RejectedRecord['checksum']): RejectedRecord {
  return checksum ? { ok: false, code, message, checksum } : { ok: false, code, message };
}

/** Parse one record with CR/LF already removed. Whitespace is preserved for the checksum. */
export function parseRecord(raw: string, profile: ProfileSettings): ParseResult {
  if (raw.length === 0) return reject('empty', 'Empty line');
  if (raw.length > MAX_RECORD_BYTES) return reject('record_too_long', `Line is ${raw.length} bytes; the limit is ${MAX_RECORD_BYTES}`);
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) {
      return reject('non_ascii', `Unexpected byte 0x${c.toString(16).padStart(2, '0')} at position ${i + 1}. Check the baud rate (9600) and cable.`);
    }
  }

  const star = raw.indexOf('*');
  if (star < 0 || raw.indexOf('*', star + 1) >= 0) {
    return reject('missing_checksum', 'Expected exactly one *CHECKSUM at the end of the line');
  }
  const payload = raw.slice(0, star);
  const calculated = computeChecksum(payload);
  const digits = raw.slice(star + 1).replace(/ +$/, '');
  if (!/^\d{1,5}$/.test(digits)) {
    return reject('missing_checksum', `Checksum "${digits}" is not a decimal number`, { reported: null, calculated });
  }
  const reported = Number(digits);
  if (reported !== calculated) {
    return reject(
      'checksum_mismatch',
      `Checksum mismatch: the line says ${digits}, the bytes before * add up to ${calculated}`,
      { reported, calculated },
    );
  }

  const parts = payload.split(',');
  if (parts.length > 0 && parts[parts.length - 1]!.trim() === '') parts.pop();
  const keys = expectedFields(profile);
  if (parts.length !== keys.length) {
    return reject(
      'wrong_layout',
      `Expected ${keys.length} fields (${keys.join(',')}) for this profile, found ${parts.length}. Check the voltage/compass/format settings.`,
      { reported, calculated },
    );
  }

  const fields = keys.map((key, i) => ({ key, text: parts[i]!.trim() }));
  const num: Partial<Record<FieldKey, number>> = {};
  let config: string | null = null;
  for (const { key, text } of fields) {
    if (key === 'CONFIG') {
      config = text;
      continue;
    }
    if (text === '') return reject('invalid_number', `${FIELD_LABELS[key]} (${key}) is empty`, { reported, calculated });
    if (!NUMBER.test(text)) return reject('invalid_number', `${FIELD_LABELS[key]} (${key}) is not a number: "${text}"`, { reported, calculated });
    const v = Number(text);
    if (!Number.isFinite(v)) return reject('invalid_number', `${FIELD_LABELS[key]} (${key}) is not finite`, { reported, calculated });
    num[key] = v;
  }

  const m: Measurements = {
    windSpeedMs: windToMs(num.WS!, profile.windUnit),
    windDirDeg: num.WD!,
    airTempC: tempToC(num.AT!, profile.tempUnit),
    rhPct: num.RH!,
    pressureHpa: pressureToHpa(num.BP!, profile.pressureUnit),
    rainMm: profile.rainGaugeInstalled && num.RN !== undefined ? rainToMm(num.RN, profile.rainUnit) : null,
    solarWm2: profile.solarInstalled && num.SR !== undefined ? num.SR : null,
    supplyV: num.BV ?? null,
    compassDeg: num.CMP ?? null,
  };

  for (const [k, [lo, hi]] of Object.entries(BOUNDS) as [keyof Measurements, readonly [number, number]][]) {
    const v = m[k];
    if (v !== null && (v < lo || v > hi)) {
      return reject(
        'out_of_range',
        `${k} = ${round(v)} is outside ${lo}–${hi}. If this is wrong, check the units the instrument is set to.`,
        { reported, calculated },
      );
    }
  }
  if (m.windDirDeg === 360) m.windDirDeg = 0;
  if (m.compassDeg === 360) m.compassDeg = 0;

  return { ok: true, measurements: m, config, checksum: { reported, calculated }, fields };
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}

/** Build a correctly checksummed line (simulator and tests). */
export function withChecksum(payload: string, digits = 5): string {
  return `${payload}*${String(computeChecksum(payload)).padStart(digits, '0')}`;
}
