// Input profile: how to interpret the instrument's serial records.
// Option lists come from the AIO 2 manual (Rev G, section 6 and appendix A).

export const RECORD_FORMATS = ['standard', 'legacy'] as const;
export const WIND_INPUT_UNITS = ['m/s', 'mph'] as const; // SU0 / SU1
export const TEMP_INPUT_UNITS = ['C', 'F'] as const; // TU1 / TU0
export const PRESSURE_INPUT_UNITS = ['hPa', 'inHg', 'mmHg'] as const; // PU0 / PU1 / PU2
export const RAIN_INPUT_UNITS = ['mm', 'in'] as const; // RU0 / RU1
export const DIRECTION_REFERENCES = ['magnetic', 'true', 'unconfirmed'] as const;
export const OUTPUT_INTERVALS = [1, 2, 5, 15, 30, 60] as const; // OI1..OI6, seconds

export type RecordFormat = (typeof RECORD_FORMATS)[number];
export type WindInputUnit = (typeof WIND_INPUT_UNITS)[number];
export type TempInputUnit = (typeof TEMP_INPUT_UNITS)[number];
export type PressureInputUnit = (typeof PRESSURE_INPUT_UNITS)[number];
export type RainInputUnit = (typeof RAIN_INPUT_UNITS)[number];
export type DirectionReference = (typeof DIRECTION_REFERENCES)[number];

export interface ProfileSettings {
  format: RecordFormat;
  /** Standard format only: BV1 adds supply voltage after the solar field. */
  includesVoltage: boolean;
  /** Standard format only: CV1 adds the alignment-compass heading before CONFIG. */
  includesCompass: boolean;
  windUnit: WindInputUnit;
  tempUnit: TempInputUnit;
  pressureUnit: PressureInputUnit;
  rainUnit: RainInputUnit;
  rainGaugeInstalled: boolean;
  solarInstalled: boolean;
  directionReference: DirectionReference;
  intervalSeconds: (typeof OUTPUT_INTERVALS)[number];
  /** The owner checked the instrument's actual output units. Required before ingestion. */
  unitsConfirmed: boolean;
}

export interface InputProfile extends ProfileSettings {
  id: number;
  version: number;
  createdAt: string;
}

/** Suggestions shown in setup. These match the factory defaults but still need confirmation. */
export const SUGGESTED_PROFILE: ProfileSettings = {
  format: 'standard',
  includesVoltage: true,
  includesCompass: false,
  windUnit: 'm/s',
  tempUnit: 'C',
  pressureUnit: 'hPa',
  rainUnit: 'mm',
  rainGaugeInstalled: false,
  solarInstalled: false,
  directionReference: 'unconfirmed',
  intervalSeconds: 1,
  unitsConfirmed: false,
};

export type FieldKey = 'WS' | 'WD' | 'AT' | 'RH' | 'BP' | 'RN' | 'SR' | 'BV' | 'CMP' | 'CONFIG';

export const FIELD_LABELS: Record<FieldKey, string> = {
  WS: 'Wind speed',
  WD: 'Wind direction',
  AT: 'Air temperature',
  RH: 'Relative humidity',
  BP: 'Barometric pressure',
  RN: 'Rain field',
  SR: 'Solar radiation',
  BV: 'Supply voltage',
  CMP: 'Alignment compass',
  CONFIG: 'Configuration marker',
};

/** Field order the profile expects, excluding the trailing *CHECKSUM. */
export function expectedFields(p: Pick<ProfileSettings, 'format' | 'includesVoltage' | 'includesCompass'>): FieldKey[] {
  if (p.format === 'legacy') return ['WS', 'WD', 'AT', 'RH', 'BP'];
  const fields: FieldKey[] = ['WS', 'WD', 'AT', 'RH', 'BP', 'RN', 'SR'];
  if (p.includesVoltage) fields.push('BV');
  if (p.includesCompass) fields.push('CMP');
  fields.push('CONFIG');
  return fields;
}

/** Stale policy from the spec: max(10 s, 3 × expected interval). */
export function staleThresholdMs(intervalSeconds: number): number {
  return Math.max(10_000, 3 * intervalSeconds * 1000);
}

type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function oneOf<T extends readonly unknown[]>(list: T, v: unknown): v is T[number] {
  return list.includes(v as T[number]);
}

export function validateProfileSettings(input: unknown): Validation<ProfileSettings> {
  const errors: string[] = [];
  const o = (input ?? {}) as Record<string, unknown>;
  const bool = (k: string) => {
    if (typeof o[k] !== 'boolean') errors.push(`${k} must be true or false`);
    return o[k] === true;
  };
  if (!oneOf(RECORD_FORMATS, o.format)) errors.push('format must be standard or legacy');
  if (!oneOf(WIND_INPUT_UNITS, o.windUnit)) errors.push('windUnit must be m/s or mph');
  if (!oneOf(TEMP_INPUT_UNITS, o.tempUnit)) errors.push('tempUnit must be C or F');
  if (!oneOf(PRESSURE_INPUT_UNITS, o.pressureUnit)) errors.push('pressureUnit must be hPa, inHg or mmHg');
  if (!oneOf(RAIN_INPUT_UNITS, o.rainUnit)) errors.push('rainUnit must be mm or in');
  if (!oneOf(DIRECTION_REFERENCES, o.directionReference)) errors.push('directionReference must be magnetic, true or unconfirmed');
  if (!oneOf(OUTPUT_INTERVALS, o.intervalSeconds)) errors.push('intervalSeconds must be 1, 2, 5, 15, 30 or 60');
  const value: ProfileSettings = {
    format: o.format as RecordFormat,
    includesVoltage: bool('includesVoltage'),
    includesCompass: bool('includesCompass'),
    windUnit: o.windUnit as WindInputUnit,
    tempUnit: o.tempUnit as TempInputUnit,
    pressureUnit: o.pressureUnit as PressureInputUnit,
    rainUnit: o.rainUnit as RainInputUnit,
    rainGaugeInstalled: bool('rainGaugeInstalled'),
    solarInstalled: bool('solarInstalled'),
    directionReference: o.directionReference as DirectionReference,
    intervalSeconds: o.intervalSeconds as ProfileSettings['intervalSeconds'],
    unitsConfirmed: bool('unitsConfirmed'),
  };
  if (value.format === 'legacy') {
    // The manual documents only the five-measurement legacy layout.
    if (value.includesVoltage || value.includesCompass) {
      errors.push('The legacy format has no documented voltage or compass fields; turn those off or use the standard format');
    }
    if (value.rainGaugeInstalled || value.solarInstalled) {
      errors.push('The legacy format has no rain or solar fields; use the standard format to record them');
    }
  }
  if (!value.unitsConfirmed) errors.push('Confirm that the units match the instrument output before recording');
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** True when two settings objects interpret records identically. */
export function sameInterpretation(a: ProfileSettings, b: ProfileSettings): boolean {
  const keys = Object.keys(SUGGESTED_PROFILE) as (keyof ProfileSettings)[];
  return keys.every((k) => a[k] === b[k]);
}

export function pickProfileSettings(p: ProfileSettings): ProfileSettings {
  const keys = Object.keys(SUGGESTED_PROFILE) as (keyof ProfileSettings)[];
  return Object.fromEntries(keys.map((k) => [k, p[k]])) as unknown as ProfileSettings;
}
