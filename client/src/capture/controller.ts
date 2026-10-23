// Owns the capture session in this tab: port, line framing, validation, durable queuing, upload.

import { LineFramer } from '../../../shared/framer';
import { parseRecord, type Measurements, type ParsedRecord } from '../../../shared/parser';
import { SUGGESTED_PROFILE, staleThresholdMs, type InputProfile, type ProfileSettings } from '../../../shared/profile';
import { api, ApiError } from '../lib/api';
import { SimulatedConnection } from '../serial/simulator';
import { SerialFailure, type SerialConnection } from '../serial/types';
import { requestAndOpen, reopen, serialSupport } from '../serial/webSerial';
import { ObservationQueue, QueueFullError } from './queue';
import { Uploader, type UploaderSnapshot } from './uploader';

export type CaptureMode = 'off' | 'real' | 'demo';
export type CapturePhase = 'disconnected' | 'connecting' | 'waiting' | 'receiving' | 'stale';

export interface LocalObservation {
  t: number;
  m: Measurements;
}

export interface TerminalLine {
  n: number;
  t: number;
  text: string;
  ok: boolean;
  reason?: string;
}

export interface CaptureSnapshot {
  mode: CaptureMode;
  phase: CapturePhase;
  error: { code: string; message: string } | null;
  notice: string | null;
  portDescription: string | null;
  profile: ProfileSettings | null;
  sessionId: string | null;
  bytes: number;
  lines: number;
  valid: number;
  rejected: number;
  lastValidAt: number | null;
  lastRaw: string | null;
  lastParsed: ParsedRecord | null;
  terminal: TerminalLine[];
  recent: LocalObservation[];
  recordingPaused: string | null;
  notSaved: number;
  upload: UploaderSnapshot;
}

const LOCK_NAME = 'aio2-capture-owner';
const TERMINAL_LINES = 200;
const RECENT_REAL = 900; // 15 min at 1 Hz, for the live dial and trail
const RECENT_DEMO = 3600; // demo computes its own summaries locally

/** Fixed profile used by demo mode; never stored on the server. */
export const DEMO_PROFILE: ProfileSettings = { ...SUGGESTED_PROFILE, directionReference: 'magnetic', unitsConfirmed: true };

export class CaptureController {
  readonly queue = new ObservationQueue();
  readonly uploader: Uploader;
  private conn: SerialConnection | null = null;
  private framer = new LineFramer();
  private seq = 0;
  private releaseLock: (() => void) | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private lineNo = 0;
  private snap: CaptureSnapshot;

  constructor() {
    this.uploader = new Uploader({
      queue: this.queue,
      postBatch: (b) => api.batch(b),
      registerSession: (id, profileId) => api.registerCapture(id, profileId),
      classify: (e) =>
        e instanceof ApiError
          ? { status: e.status, retryAfterMs: e.retryAfterMs, message: e.message }
          : { status: 0, retryAfterMs: null, message: (e as Error)?.message ?? 'unknown error' },
    });
    this.snap = {
      mode: 'off', phase: 'disconnected', error: null, notice: null, portDescription: null, profile: null, sessionId: null,
      bytes: 0, lines: 0, valid: 0, rejected: 0, lastValidAt: null, lastRaw: null, lastParsed: null,
      terminal: [], recent: [], recordingPaused: null, notSaved: 0, upload: this.uploader.snapshot,
    };
    this.uploader.subscribe((u) => this.set({ upload: u }));
  }

  get snapshot() {
    return this.snap;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snap;

  private set(p: Partial<CaptureSnapshot>) {
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l());
  }

  clearError() {
    this.set({ error: null, notice: null });
  }

  /** Start uploading anything left in the queue from earlier visits. */
  startUploads() {
    this.uploader.start();
  }

  stopUploads() {
    this.uploader.stop();
  }

  private resetCounters(mode: CaptureMode, profile: ProfileSettings) {
    this.framer.reset();
    this.seq = 0;
    this.lineNo = 0;
    this.set({
      mode, profile, error: null, notice: null, bytes: 0, lines: 0, valid: 0, rejected: 0, lastValidAt: null, lastRaw: null,
      lastParsed: null, terminal: [], recent: [], recordingPaused: null, notSaved: 0,
    });
  }

  /** Real capture. Call directly from the Connect button's click handler. */
  async connect(profile: InputProfile, port?: SerialPort) {
    if (this.snap.mode !== 'off') return;
    const support = serialSupport();
    if (!support.ok) {
      this.set({ error: { code: support.code, message: support.message } });
      return;
    }
    if (!profile.unitsConfirmed) {
      this.set({ error: { code: 'profile', message: 'Confirm the instrument output settings before connecting.' } });
      return;
    }
    this.set({ phase: 'connecting', error: null, notice: null });

    // One capture owner per browser profile/origin.
    const got = await this.acquireLock();
    if (!got) {
      this.set({ phase: 'disconnected', error: { code: 'another_tab', message: 'Another tab or window in this browser is already capturing from the instrument. Use that tab, or disconnect it first.' } });
      return;
    }

    try {
      this.conn = port ? await reopen(port) : await requestAndOpen();
    } catch (e) {
      this.releaseLock?.();
      this.releaseLock = null;
      const f = e instanceof SerialFailure ? e : new SerialFailure('open_failed', (e as Error).message);
      if (f.code === 'cancelled') this.set({ phase: 'disconnected', notice: 'No port selected. Click Connect and choose the instrument’s port.' });
      else this.set({ phase: 'disconnected', error: { code: f.code, message: f.message } });
      return;
    }

    void navigator.storage?.persist?.().catch(() => undefined);
    const sessionId = crypto.randomUUID();
    this.resetCounters('real', profile);
    this.set({ phase: 'waiting', sessionId, portDescription: this.conn.description });
    api.registerCapture(sessionId, profile.id).catch(() => undefined); // the uploader retries this
    this.startStaleTimer(profile.intervalSeconds);
    void this.readLoop(this.conn, profile, sessionId);
  }

  /** Demo capture from the simulator. Nothing is queued or uploaded. */
  async startDemo() {
    if (this.snap.mode !== 'off') return;
    this.resetCounters('demo', DEMO_PROFILE);
    const sim = new SimulatedConnection();
    this.conn = sim;
    this.set({ phase: 'waiting', sessionId: null, portDescription: sim.description });
    this.startStaleTimer(1);
    void this.readLoop(sim, DEMO_PROFILE, null);
  }

  get simulator(): SimulatedConnection | null {
    return this.conn instanceof SimulatedConnection ? this.conn : null;
  }

  async disconnect(reason?: { code: string; message: string }) {
    const conn = this.conn;
    const wasReal = this.snap.mode === 'real';
    const sessionId = this.snap.sessionId;
    this.conn = null;
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = null;
    await conn?.close().catch(() => undefined);
    this.releaseLock?.();
    this.releaseLock = null;
    if (wasReal && sessionId) api.endCapture(sessionId).catch(() => undefined);
    const clearDemo = this.snap.mode === 'demo'
      ? { recent: [], terminal: [], lastRaw: null, lastParsed: null, lastValidAt: null, bytes: 0, lines: 0, valid: 0, rejected: 0, profile: null }
      : {};
    this.set({ mode: 'off', phase: 'disconnected', error: reason ?? null, portDescription: null, sessionId: null, ...clearDemo });
  }

  private acquireLock(): Promise<boolean> {
    if (!('locks' in navigator)) return Promise.resolve(true);
    return new Promise((resolve) => {
      void navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise<void>((release) => (this.releaseLock = release));
      });
    });
  }

  private startStaleTimer(intervalSeconds: number) {
    const threshold = staleThresholdMs(intervalSeconds);
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = setInterval(() => {
      const last = this.snap.lastValidAt;
      if (this.snap.phase === 'receiving' && last && Date.now() - last > threshold) this.set({ phase: 'stale' });
    }, 1000);
  }

  private pushTerminal(text: string, ok: boolean, reason?: string) {
    const line: TerminalLine = { n: ++this.lineNo, t: Date.now(), text, ok, reason };
    const terminal = this.snap.terminal.length >= TERMINAL_LINES ? [...this.snap.terminal.slice(1), line] : [...this.snap.terminal, line];
    return terminal;
  }

  private async readLoop(conn: SerialConnection, profile: ProfileSettings & { id?: number }, sessionId: string | null) {
    try {
      for await (const chunk of conn.chunks()) {
        if (this.conn !== conn) break;
        this.set({ bytes: this.snap.bytes + chunk.length });
        for (const ev of this.framer.push(chunk)) {
          if (ev.type === 'overflow') {
            this.set({ rejected: this.snap.rejected + 1, terminal: this.pushTerminal(`${ev.sample}…`, false, ev.message) });
            continue;
          }
          await this.handleLine(ev.raw, profile, sessionId);
        }
      }
    } catch (e) {
      if (this.conn === conn) {
        const f = e instanceof SerialFailure ? e : new SerialFailure('read_failed', (e as Error).message);
        await this.disconnect({ code: f.code, message: f.message });
      }
    }
  }

  private async handleLine(raw: string, profile: ProfileSettings & { id?: number }, sessionId: string | null) {
    const t = Date.now();
    const parsed = parseRecord(raw, profile);
    if (!parsed.ok) {
      this.set({ lines: this.snap.lines + 1, rejected: this.snap.rejected + 1, lastRaw: raw, terminal: this.pushTerminal(raw, false, parsed.message) });
      return;
    }
    const max = this.snap.mode === 'demo' ? RECENT_DEMO : RECENT_REAL;
    const recent = this.snap.recent.length >= max ? [...this.snap.recent.slice(1), { t, m: parsed.measurements }] : [...this.snap.recent, { t, m: parsed.measurements }];
    const update: Partial<CaptureSnapshot> = {
      lines: this.snap.lines + 1, valid: this.snap.valid + 1, lastValidAt: t, lastRaw: raw, lastParsed: parsed,
      phase: 'receiving', recent, terminal: this.pushTerminal(raw, true),
    };
    if (this.snap.mode === 'real' && sessionId && profile.id !== undefined) {
      try {
        await this.queue.put({ id: crypto.randomUUID(), sessionId, profileId: profile.id, sequence: ++this.seq, observedAt: new Date(t).toISOString(), raw });
        if (this.snap.recordingPaused) update.recordingPaused = null;
        this.uploader.nudge();
      } catch (e) {
        update.notSaved = this.snap.notSaved + 1;
        update.recordingPaused = e instanceof QueueFullError
          ? 'Recording paused: this browser’s storage is full, so new readings are shown but not saved. Free disk space, then reconnect.'
          : `Recording paused: readings could not be stored in this browser (${(e as Error).message}).`;
      }
    }
    this.set(update);
  }
}

export const capture = new CaptureController();
