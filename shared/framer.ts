// Turns arbitrary serial byte chunks into CR/LF-delimited records.

import { MAX_RECORD_BYTES } from './parser';

export type FrameEvent =
  | { type: 'line'; raw: string }
  | { type: 'overflow'; sample: string; message: string };

const CR = 0x0d;
const LF = 0x0a;

export class LineFramer {
  private buf: number[] = [];
  private discarding = false;

  /** Feed one chunk; returns every complete record in it. Partial lines carry over. */
  push(chunk: Uint8Array): FrameEvent[] {
    const out: FrameEvent[] = [];
    for (const byte of chunk) {
      if (byte === CR || byte === LF) {
        // A CR/LF pair (even split across chunks) or blank line yields nothing extra.
        if (!this.discarding && this.buf.length > 0) out.push({ type: 'line', raw: latin1(this.buf) });
        this.buf = [];
        this.discarding = false;
        continue;
      }
      if (this.discarding) continue;
      this.buf.push(byte);
      if (this.buf.length > MAX_RECORD_BYTES) {
        out.push({
          type: 'overflow',
          sample: latin1(this.buf.slice(0, 80)),
          message: `No line ending within ${MAX_RECORD_BYTES} bytes; discarding until the next CR/LF. Check the baud rate and that the port is the instrument.`,
        });
        this.buf = [];
        this.discarding = true;
      }
    }
    return out;
  }

  reset() {
    this.buf = [];
    this.discarding = false;
  }

  get pendingBytes() {
    return this.buf.length;
  }
}

function latin1(bytes: number[]): string {
  return String.fromCharCode(...bytes);
}
