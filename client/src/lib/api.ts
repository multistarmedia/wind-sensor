// Same-origin API client. Mutations carry the CSRF token; 401s notify the app so it can prompt sign-in.

import type {
  BatchRequest, BatchResponse, DiagnosticsResponse, HistoryResponse, LogResponse, SessionResponse,
  SettingsResponse, SettingsUpdate, StatusResponse, WindRoseResponse,
} from '../../../shared/api';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterMs: number | null = null) {
    super(message);
  }
}

let csrfToken: string | null = null;
const authListeners = new Set<() => void>();
let clockSkewMs = 0;
const skewListeners = new Set<(ms: number) => void>();

export function onUnauthenticated(cb: () => void) {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}
export function onClockSkew(cb: (ms: number) => void) {
  skewListeners.add(cb);
  return () => skewListeners.delete(cb);
}
export function currentClockSkew() {
  return clockSkewMs;
}

function noteServerTime(serverTime: string | undefined, sentAt: number) {
  if (!serverTime) return;
  const t = Date.parse(serverTime);
  if (!Number.isFinite(t)) return;
  const local = (sentAt + Date.now()) / 2;
  const skew = t - local;
  if (Math.abs(skew - clockSkewMs) > 2000) {
    clockSkewMs = skew;
    skewListeners.forEach((l) => l(skew));
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const sentAt = Date.now();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'The server could not be reached');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login') authListeners.forEach((l) => l());
    const ra = res.headers.get('Retry-After');
    throw new ApiError(res.status, String(data.code ?? 'error'), String(data.message ?? res.statusText), ra ? Number(ra) * 1000 : null);
  }
  noteServerTime(data.serverTime as string | undefined, sentAt);
  return data as T;
}

export const api = {
  async session() {
    const s = await call<SessionResponse>('GET', '/api/session');
    csrfToken = s.csrfToken;
    return s;
  },
  async login(password: string) {
    const s = await call<SessionResponse>('POST', '/api/login', { password });
    csrfToken = s.csrfToken;
    return s;
  },
  async logout() {
    await call('POST', '/api/logout', {});
    csrfToken = null;
  },
  settings: () => call<SettingsResponse>('GET', '/api/settings'),
  updateSettings: (u: SettingsUpdate) => call<SettingsResponse>('PUT', '/api/settings', u),
  registerCapture: (id: string, profileId: number) => call<{ id: string }>('POST', '/api/capture-sessions', { id, profileId }),
  endCapture: (id: string) => call('POST', `/api/capture-sessions/${id}/end`, {}),
  batch: (b: BatchRequest) => call<BatchResponse>('POST', '/api/observations/batch', b),
  status: () => call<StatusResponse>('GET', '/api/status'),
  history: (from: Date, to: Date) => call<HistoryResponse>('GET', `/api/history?from=${from.toISOString()}&to=${to.toISOString()}`),
  windRose: (from: Date, to: Date) => call<WindRoseResponse>('GET', `/api/windrose?from=${from.toISOString()}&to=${to.toISOString()}`),
  log: (before?: string | null) => call<LogResponse>('GET', `/api/log${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  diagnostics: () => call<DiagnosticsResponse>('GET', '/api/diagnostics'),
  exportUrl: (from: Date, to: Date) => `/api/export.csv?from=${from.toISOString()}&to=${to.toISOString()}`,
};
