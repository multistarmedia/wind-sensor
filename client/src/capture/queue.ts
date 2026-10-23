// Durable upload queue in IndexedDB. A reading counts as safely queued only after put() resolves.

export interface QueuedObservation {
  id: string;
  sessionId: string;
  profileId: number;
  sequence: number;
  observedAt: string;
  raw: string;
  order: number;
}

export interface QuarantinedObservation extends QueuedObservation {
  code: string;
  reason: string;
  quarantinedAt: string;
}

const DB_NAME = 'aio2-console';
const PENDING = 'pending';
const QUARANTINE = 'quarantine';
const MAX_QUARANTINE = 500;

export class QueueFullError extends Error {}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

function isQuota(e: unknown) {
  return (e as DOMException)?.name === 'QuotaExceededError';
}

export class ObservationQueue {
  private dbp: Promise<IDBDatabase> | null = null;
  private counter = 0;

  constructor(private factory: IDBFactory = indexedDB, private name = DB_NAME) {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const open = this.factory.open(this.name, 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          db.createObjectStore(PENDING, { keyPath: 'id' }).createIndex('order', 'order');
          db.createObjectStore(QUARANTINE, { keyPath: 'id' }).createIndex('order', 'order');
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
    }
    return this.dbp;
  }

  nextOrder() {
    return Date.now() * 1000 + (this.counter++ % 1000);
  }

  async put(o: Omit<QueuedObservation, 'order'>): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(PENDING, 'readwrite');
    try {
      tx.objectStore(PENDING).put({ ...o, order: this.nextOrder() });
      await done(tx);
    } catch (e) {
      if (isQuota(e)) throw new QueueFullError('Browser storage is full');
      throw e;
    }
  }

  async oldest(limit: number): Promise<QueuedObservation[]> {
    const db = await this.db();
    const tx = db.transaction(PENDING, 'readonly');
    const out: QueuedObservation[] = [];
    await new Promise<void>((resolve, reject) => {
      const cur = tx.objectStore(PENDING).index('order').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || out.length >= limit) return resolve();
        out.push(c.value as QueuedObservation);
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
    return out;
  }

  async remove(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const db = await this.db();
    const tx = db.transaction(PENDING, 'readwrite');
    const store = tx.objectStore(PENDING);
    for (const id of ids) store.delete(id);
    await done(tx);
  }

  /** Move rejected records out of the pending queue, keeping a bounded sample for diagnostics. */
  async quarantine(items: { record: QueuedObservation; code: string; reason: string }[]): Promise<void> {
    if (!items.length) return;
    const db = await this.db();
    const tx = db.transaction([PENDING, QUARANTINE], 'readwrite');
    const q = tx.objectStore(QUARANTINE);
    for (const { record, code, reason } of items) {
      q.put({ ...record, code, reason, quarantinedAt: new Date().toISOString() } satisfies QuarantinedObservation);
      tx.objectStore(PENDING).delete(record.id);
    }
    await done(tx);
    const count = await this.quarantineCount();
    if (count > MAX_QUARANTINE) {
      const tx2 = db.transaction(QUARANTINE, 'readwrite');
      const cur = tx2.objectStore(QUARANTINE).index('order').openCursor();
      let excess = count - MAX_QUARANTINE;
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || excess <= 0) return;
        c.delete();
        excess--;
        c.continue();
      };
      await done(tx2);
    }
  }

  async count(): Promise<number> {
    const db = await this.db();
    return req(db.transaction(PENDING, 'readonly').objectStore(PENDING).count());
  }

  async quarantineCount(): Promise<number> {
    const db = await this.db();
    return req(db.transaction(QUARANTINE, 'readonly').objectStore(QUARANTINE).count());
  }

  async listQuarantine(limit = 50): Promise<QuarantinedObservation[]> {
    const db = await this.db();
    const all = (await req(db.transaction(QUARANTINE, 'readonly').objectStore(QUARANTINE).getAll())) as QuarantinedObservation[];
    return all.sort((a, b) => b.order - a.order).slice(0, limit);
  }
}
