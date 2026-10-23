import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { BatchRequest, BatchResponse } from '../shared/api';
import { LineFramer } from '../shared/framer';
import { parseRecord } from '../shared/parser';
import { ObservationQueue, QueueFullError } from '../client/src/capture/queue';
import { Uploader } from '../client/src/capture/uploader';
import { SimulatedConnection, simulatedLine } from '../client/src/serial/simulator';
import { DEMO_PROFILE } from '../client/src/capture/controller';

const LINE = '000.6,272,+023.6,022,0974.3,000.00,0000,12.7,U0,*02355';

class HttpError extends Error {
  constructor(public status: number, public retryAfterMs: number | null = null) {
    super(`HTTP ${status}`);
  }
}

function makeQueue() {
  return new ObservationQueue(new IDBFactory(), `test-${Math.random()}`);
}

async function fill(q: ObservationQueue, n: number, sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    await q.put({ id, sessionId, profileId: 1, sequence: i + 1, observedAt: new Date(1_700_000_000_000 + i * 1000).toISOString(), raw: LINE });
  }
  return ids;
}

/** A fake server that stores ids idempotently and can be taken offline. */
function fakeServer() {
  const stored = new Map<string, BatchRequest['records'][number]>();
  const state = { offline: false, loseNextResponse: false, unauthorized: false, calls: 0 };
  const postBatch = async (b: BatchRequest): Promise<BatchResponse> => {
    state.calls++;
    if (state.unauthorized) throw new HttpError(401);
    if (state.offline) throw new HttpError(0);
    const res: BatchResponse = { accepted: [], duplicates: [], rejected: [], serverTime: new Date().toISOString() };
    for (const r of b.records) {
      if (r.raw.endsWith('*02257')) { res.rejected.push({ id: r.id, code: 'checksum_mismatch', message: 'bad' }); continue; }
      if (stored.has(r.id)) res.duplicates.push(r.id);
      else { stored.set(r.id, r); res.accepted.push(r.id); }
    }
    if (state.loseNextResponse) {
      state.loseNextResponse = false;
      throw new HttpError(0); // committed on the server, but the client never hears back
    }
    return res;
  };
  return { stored, state, postBatch };
}

function makeUploader(q: ObservationQueue, server: ReturnType<typeof fakeServer>) {
  return new Uploader({
    queue: q,
    postBatch: server.postBatch,
    registerSession: async () => undefined,
    classify: (e) => ({ status: e instanceof HttpError ? e.status : 0, retryAfterMs: e instanceof HttpError ? e.retryAfterMs : null, message: String(e) }),
    setTimer: () => 0, // ticks are driven manually
    clearTimer: () => undefined,
    random: () => 0.5,
  });
}

describe('upload queue', () => {
  it('queues during an outage and uploads each record exactly once on recovery, keeping ids and timestamps (acceptance 12)', async () => {
    const q = makeQueue();
    const server = fakeServer();
    const up = makeUploader(q, server);
    server.state.offline = true;
    const ids = await fill(q, 150);
    await up.tick();
    await up.tick();
    expect(up.snapshot.state).toBe('offline');
    expect(await q.count()).toBe(150);

    server.state.offline = false;
    await up.tick();
    await up.tick();
    expect(await q.count()).toBe(0);
    expect(server.stored.size).toBe(150);
    expect([...server.stored.keys()].sort()).toEqual([...ids].sort());
    expect(server.stored.get(ids[0]!)!.observedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(up.snapshot.state).toBe('saved');
  });

  it('retries after a lost response without duplicating (acceptance 13)', async () => {
    const q = makeQueue();
    const server = fakeServer();
    const up = makeUploader(q, server);
    await fill(q, 10);
    server.state.loseNextResponse = true;
    await up.tick();
    expect(await q.count()).toBe(10); // not removed: never acknowledged
    await up.tick();
    expect(await q.count()).toBe(0);
    expect(server.stored.size).toBe(10);
  });

  it('keeps records and never shows Saved when the session expires (acceptance 15)', async () => {
    const q = makeQueue();
    const server = fakeServer();
    const up = makeUploader(q, server);
    await fill(q, 5);
    server.state.unauthorized = true;
    await up.tick();
    expect(up.snapshot.state).toBe('paused');
    expect(await q.count()).toBe(5);
    await up.tick(); // paused: no further attempts until sign-in
    expect(server.state.calls).toBe(1);

    server.state.unauthorized = false;
    up.resumeAfterAuth();
    await up.tick();
    expect(await q.count()).toBe(0);
    expect(up.snapshot.state).toBe('saved');
  });

  it('quarantines server-rejected records with their reason instead of dropping them', async () => {
    const q = makeQueue();
    const server = fakeServer();
    const up = makeUploader(q, server);
    await q.put({ id: crypto.randomUUID(), sessionId: 's', profileId: 1, sequence: 1, observedAt: new Date().toISOString(), raw: LINE.replace('02355', '02257') });
    await up.tick();
    expect(await q.count()).toBe(0);
    const quarantined = await q.listQuarantine();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]!.code).toBe('checksum_mismatch');
  });

  it('reports a storage quota failure instead of silently dropping (acceptance 15)', async () => {
    const q = makeQueue();
    await fill(q, 1);
    // Simulate a full disk: the transaction aborts with QuotaExceededError.
    const realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('full', 'QuotaExceededError');
    };
    try {
      await expect(q.put({ id: crypto.randomUUID(), sessionId: 's', profileId: 1, sequence: 2, observedAt: new Date().toISOString(), raw: LINE }))
        .rejects.toBeInstanceOf(QueueFullError);
    } finally {
      IDBObjectStore.prototype.put = realPut;
    }
    expect(await q.count()).toBe(1);
  });
});

describe('simulator (demo)', () => {
  it('produces framed, correctly checksummed records in fragments', async () => {
    const sim = new SimulatedConnection(1);
    const framer = new LineFramer();
    const lines: string[] = [];
    let chunks = 0;
    for await (const c of sim.chunks()) {
      chunks++;
      for (const e of framer.push(c)) if (e.type === 'line') lines.push(e.raw);
      if (lines.length >= 5) break;
    }
    await sim.close();
    expect(chunks).toBeGreaterThan(5);
    for (const l of lines) expect(parseRecord(l, DEMO_PROFILE).ok).toBe(true);
  });

  it('can inject a corrupted line that fails validation', () => {
    const good = simulatedLine({ ws: 3, wd: 90, at: 20, rh: 50, bp: 1010, bv: 12 });
    expect(parseRecord(good, DEMO_PROFILE).ok).toBe(true);
    expect(parseRecord(good.replace(/,(\d)/, ',7$1'), DEMO_PROFILE).ok).toBe(false);
  });
});

describe('demo isolation (acceptance 21)', () => {
  it('shows simulated readings without queuing or uploading anything', async () => {
    const { CaptureController } = await import('../client/src/capture/controller');
    const c = new CaptureController();
    const before = await c.queue.count();
    await c.startDemo();
    await new Promise((r) => setTimeout(r, 2300));
    expect(c.snapshot.mode).toBe('demo');
    expect(c.snapshot.valid).toBeGreaterThan(0);
    expect(await c.queue.count()).toBe(before);
    await c.disconnect();
    expect(c.snapshot.recent).toHaveLength(0);
    expect(c.snapshot.mode).toBe('off');
  });
});
