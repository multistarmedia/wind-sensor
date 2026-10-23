// Simulated AIO 2 for demo mode and tests. Every value it produces is synthetic.

import { withChecksum } from '../../../shared/parser';
import { SerialFailure, type SerialConnection } from './types';

export interface SimulatorControls {
  corruptNext(): void;
  pause(ms: number): void;
  unplug(): void;
  oversizeNext(): void;
}

const pad = (v: number, int: number, dec: number, sign = false) => {
  const s = Math.abs(v).toFixed(dec).padStart(int + (dec ? dec + 1 : 0), '0');
  return sign ? (v < 0 ? '-' : '+') + s : s;
};

/** Standard layout with supply voltage, metric (the demo profile). */
export function simulatedLine(m: { ws: number; wd: number; at: number; rh: number; bp: number; bv: number }) {
  const payload = [
    pad(m.ws, 3, 1), pad(Math.round(m.wd) % 360, 3, 0), pad(m.at, 3, 1, true), pad(Math.round(m.rh), 3, 0),
    pad(m.bp, 4, 1), '000.00', '0000', pad(m.bv, 2, 1), 'M0',
  ].join(',') + ',';
  return withChecksum(payload);
}

export class SimulatedConnection implements SerialConnection, SimulatorControls {
  readonly description = 'Simulated AIO 2 (demo data)';
  private closed = false;
  private corrupt = false;
  private oversize = false;
  private pausedUntil = 0;
  private unplugged = false;
  private wake: (() => void) | null = null;
  private t = 0;
  private speed = 4 + Math.random() * 4;
  private dir = 200 + Math.random() * 100;

  constructor(private intervalMs = 1000) {}

  corruptNext() { this.corrupt = true; }
  oversizeNext() { this.oversize = true; }
  pause(ms: number) { this.pausedUntil = Date.now() + ms; }
  unplug() { this.unplugged = true; this.wake?.(); }

  private nextLine(): string {
    this.t++;
    // Random walk with occasional bursts so the dial and rose have something to show.
    const burst = Math.random() < 0.04 ? 3 + Math.random() * 6 : 0;
    this.speed = Math.max(0, Math.min(25, this.speed + (Math.random() - 0.5) * 1.6 + (6 - this.speed) * 0.02));
    this.dir = (this.dir + (Math.random() - 0.5) * 18 + 360) % 360;
    const line = simulatedLine({
      ws: Math.min(60, this.speed + burst),
      wd: this.dir,
      at: 18 + 4 * Math.sin(this.t / 600) + (Math.random() - 0.5) * 0.2,
      rh: 52 - 8 * Math.sin(this.t / 600) + (Math.random() - 0.5),
      bp: 1012 + Math.sin(this.t / 3000) * 1.5,
      bv: 12.4 + (Math.random() - 0.5) * 0.1,
    });
    if (this.oversize) {
      this.oversize = false;
      return '9'.repeat(700) + line;
    }
    if (this.corrupt) {
      this.corrupt = false;
      return line.replace(/,(\d)/, ',7$1'); // shifts a digit: checksum no longer matches
    }
    return line;
  }

  async *chunks(): AsyncIterable<Uint8Array> {
    const enc = new TextEncoder();
    while (!this.closed) {
      await new Promise<void>((r) => {
        this.wake = r;
        setTimeout(r, this.intervalMs);
      });
      if (this.unplugged) throw new SerialFailure('unplugged', 'Simulated unplug: the instrument stopped responding.');
      if (this.closed) break;
      if (Date.now() < this.pausedUntil) continue;
      const bytes = enc.encode(`${this.nextLine()}\r\n`);
      // Deliver in random fragments, as real serial reads do.
      let i = 0;
      while (i < bytes.length) {
        const n = 1 + Math.floor(Math.random() * 24);
        yield bytes.slice(i, i + n);
        i += n;
      }
    }
  }

  async close() {
    this.closed = true;
    this.wake?.();
  }
}
