// Moves queued observations to the server in batches. A record leaves the queue only after the server
// acknowledges it (accepted or duplicate) or explicitly rejects it (quarantined with the reason).

import type { BatchRequest, BatchResponse } from '../../../shared/api';
import { MAX_BATCH_RECORDS } from '../../../shared/api';
import type { ObservationQueue, QueuedObservation } from './queue';

export type SavingState = 'idle' | 'saving' | 'saved' | 'offline' | 'paused';

export interface UploaderSnapshot {
  state: SavingState;
  pending: number;
  quarantined: number;
  lastSavedAt: number | null;
  message: string | null;
}

export interface UploaderDeps {
  queue: ObservationQueue;
  postBatch: (b: BatchRequest) => Promise<BatchResponse>;
  registerSession: (id: string, profileId: number) => Promise<unknown>;
  /** Error classifier: returns status (0 = network) and server retry hint. */
  classify: (e: unknown) => { status: number; retryAfterMs: number | null; message: string };
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

const IDLE_MS = 2000;
const MORE_MS = 250;
const MAX_BACKOFF_MS = 60_000;

export class Uploader {
  private snap: UploaderSnapshot = { state: 'idle', pending: 0, quarantined: 0, lastSavedAt: null, message: null };
  private listeners = new Set<(s: UploaderSnapshot) => void>();
  private timer: unknown = null;
  private running = false;
  private inFlight = false;
  private failures = 0;
  private batchLimit = MAX_BATCH_RECORDS;
  private registered = new Set<string>();
  private authPaused = false;

  constructor(private deps: UploaderDeps) {}

  get snapshot() {
    return this.snap;
  }

  subscribe(fn: (s: UploaderSnapshot) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(p: Partial<UploaderSnapshot>) {
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l(this.snap));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.timer as never);
    this.timer = null;
  }

  /** After sign-in: resume immediately. */
  resumeAfterAuth() {
    this.authPaused = false;
    this.failures = 0;
    this.set({ message: null });
    this.schedule(0);
  }

  /** Something was queued; upload soon. */
  nudge() {
    if (!this.inFlight && this.running && !this.authPaused) this.schedule(MORE_MS);
  }

  private schedule(ms: number) {
    if (!this.running) return;
    if (this.timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.timer as never);
    this.timer = (this.deps.setTimer ?? setTimeout)(() => {
      this.timer = null;
      void this.tick();
    }, ms);
  }

  private backoff(retryAfterMs: number | null) {
    this.failures++;
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.failures, 6));
    const jitter = base * (0.5 + (this.deps.random ?? Math.random)() * 0.5);
    return Math.max(retryAfterMs ?? 0, jitter);
  }

  /** One upload attempt. Exposed for tests. */
  async tick(): Promise<void> {
    if (this.inFlight || this.authPaused) return;
    this.inFlight = true;
    let next = IDLE_MS;
    try {
      const pending = await this.deps.queue.oldest(this.batchLimit);
      const total = await this.deps.queue.count();
      if (pending.length === 0) {
        this.set({ pending: 0, state: this.snap.lastSavedAt ? 'saved' : 'idle', message: null });
        return;
      }
      this.set({ pending: total, state: this.snap.state === 'offline' ? 'offline' : 'saving' });
      const first = pending[0]!;
      const group = pending.filter((r) => r.sessionId === first.sessionId && r.profileId === first.profileId);

      if (!this.registered.has(first.sessionId)) {
        await this.deps.registerSession(first.sessionId, first.profileId);
        this.registered.add(first.sessionId);
      }

      const res = await this.deps.postBatch({
        captureSessionId: first.sessionId,
        profileId: first.profileId,
        records: group.map((r) => ({ id: r.id, sequence: r.sequence, observedAt: r.observedAt, raw: r.raw })),
      });

      const acked = [...res.accepted, ...res.duplicates];
      await this.deps.queue.remove(acked);
      const byId = new Map<string, QueuedObservation>(group.map((r) => [r.id, r]));
      await this.deps.queue.quarantine(
        res.rejected.filter((x) => byId.has(x.id)).map((x) => ({ record: byId.get(x.id)!, code: x.code, reason: x.message })),
      );
      this.failures = 0;
      this.batchLimit = MAX_BATCH_RECORDS;
      const left = await this.deps.queue.count();
      const quarantined = await this.deps.queue.quarantineCount();
      this.set({
        pending: left,
        quarantined,
        lastSavedAt: acked.length ? Date.now() : this.snap.lastSavedAt,
        state: left > 0 ? 'saving' : 'saved',
        message: res.rejected.length ? `${res.rejected.length} reading(s) rejected by the server; see Connection → Diagnostics` : null,
      });
      next = left > 0 ? MORE_MS : IDLE_MS;
    } catch (e) {
      const { status, retryAfterMs, message } = this.deps.classify(e);
      if (status === 401) {
        this.authPaused = true;
        this.set({ state: 'paused', message: 'Signed out. Readings are kept in this browser; sign in to resume saving.' });
        return;
      }
      if (status === 413) {
        this.batchLimit = Math.max(1, Math.floor(this.batchLimit / 2));
        next = MORE_MS;
        return;
      }
      if (status === 409 || status === 422) {
        // Session/profile mismatch for the oldest record: quarantine that group rather than retrying forever.
        const pending = await this.deps.queue.oldest(this.batchLimit);
        const first = pending[0];
        if (first) {
          await this.deps.queue.quarantine(
            pending.filter((r) => r.sessionId === first.sessionId).map((record) => ({ record, code: 'session_rejected', reason: message })),
          );
        }
        next = MORE_MS;
        return;
      }
      next = this.backoff(retryAfterMs);
      this.set({
        state: 'offline',
        pending: await this.deps.queue.count().catch(() => this.snap.pending),
        message: status === 0 ? 'Server unreachable. Readings are queued in this browser and will upload automatically.' : `Saving failed (${message}); retrying.`,
      });
    } finally {
      this.inFlight = false;
      if (!this.authPaused) this.schedule(next);
    }
  }
}
