// Request/response shapes shared by client and server.

import type { Measurements } from './parser';
import type { InputProfile, ProfileSettings } from './profile';
import type { DisplayUnits } from './units';

export const MAX_BATCH_RECORDS = 100;
export const MAX_RANGE_MS = 31 * 24 * 3600_000;

export interface BatchRecord {
  id: string;
  sequence: number;
  observedAt: string;
  raw: string;
}

export interface BatchRequest {
  captureSessionId: string;
  profileId: number;
  records: BatchRecord[];
}

export type IngestRejectCode =
  | 'checksum_mismatch'
  | 'wrong_layout'
  | 'missing_profile'
  | 'invalid_number'
  | 'out_of_range'
  | 'invalid_timestamp'
  | 'invalid_record'
  | 'record_too_long'
  | 'non_ascii'
  | 'missing_checksum'
  | 'empty'
  | 'units_unconfirmed';

export interface BatchResponse {
  accepted: string[];
  duplicates: string[];
  rejected: { id: string; code: IngestRejectCode; message: string }[];
  serverTime: string;
}

export interface StationSettings {
  name: string;
  timeZone: string;
  retentionDays: number;
  displayUnits: DisplayUnits;
  setupComplete: boolean;
}

export interface SettingsResponse {
  station: StationSettings;
  profile: InputProfile | null;
}

export interface SettingsUpdate {
  station?: Partial<StationSettings>;
  profile?: ProfileSettings;
}

export interface SessionResponse {
  authenticated: boolean;
  csrfToken: string | null;
  serverTime: string;
}

export interface ObservationView {
  id: string;
  observedAt: string;
  serverReceivedAt: string;
  m: Measurements;
}

export interface WindPoint {
  t: number;
  ws: number;
  wd: number;
}

export interface StatusResponse {
  serverTime: string;
  latest: ObservationView | null;
  freshness: { ageMs: number | null; stale: boolean; staleThresholdMs: number };
  capture: { active: boolean; lastHeartbeatAt: string | null };
  last10min: {
    samples: number;
    avgSpeedMs: number | null;
    peakSpeedMs: number | null;
    peakAt: string | null;
    meanDirDeg: number | null;
  };
  today: {
    start: string;
    samples: number;
    tempHighC: number | null;
    tempHighAt: string | null;
    tempLowC: number | null;
    tempLowAt: string | null;
    peakWindMs: number | null;
    peakWindAt: string | null;
  };
  pressureTrend: { windowHours: number; changeHpa: number | null };
  recent: WindPoint[];
}

export interface HistoryPoint {
  t: number;
  n: number;
  wsAvg: number | null;
  wsMax: number | null;
  dir: number | null;
  atAvg: number | null;
  atMin: number | null;
  atMax: number | null;
  rhAvg: number | null;
  bpAvg: number | null;
  bpMin: number | null;
  bpMax: number | null;
  srAvg: number | null;
  srMax: number | null;
  bvAvg: number | null;
}

export interface HistoryResponse {
  from: string;
  to: string;
  bucketMs: number;
  points: HistoryPoint[];
}

export interface WindRoseResponse {
  from: string;
  to: string;
  total: number;
  calm: number;
  /** counts[sector][force-1]; 16 sectors, sector 0 centred on north; forces 1–12. */
  counts: number[][];
}

export interface LogRow {
  id: string;
  observedAt: string;
  serverReceivedAt: string;
  sessionId: string;
  profileId: number;
  m: Measurements;
  config: string | null;
  raw: string;
}

export interface LogResponse {
  rows: LogRow[];
  /** Pass as `before` to get the next older page. */
  nextBefore: string | null;
}

export interface DiagnosticEvent {
  at: string;
  code: string;
  message: string;
  sample: string | null;
  sessionId: string | null;
}

export interface DiagnosticsResponse {
  events: DiagnosticEvent[];
  counters: { observations: number; rejected: number; sessions: number; dbBytes: number };
}
