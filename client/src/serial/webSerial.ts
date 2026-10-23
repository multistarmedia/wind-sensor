// Real instrument connection through the browser's Web Serial API. Read-only: nothing is ever written to the port.

import { AIO2_SERIAL_OPTIONS, SerialFailure, type SerialConnection } from './types';

export function serialSupport(): { ok: true } | { ok: false; code: 'unsupported' | 'insecure_context' | 'embedded'; message: string } {
  if (window.top !== window.self) {
    return { ok: false, code: 'embedded', message: 'Open this page directly in its own tab. Serial access does not work inside an embedded preview.' };
  }
  if (!window.isSecureContext) {
    return { ok: false, code: 'insecure_context', message: 'Serial access needs HTTPS (or http://localhost). Open the https:// address.' };
  }
  if (!('serial' in navigator)) {
    return {
      ok: false,
      code: 'unsupported',
      message: 'This browser cannot read serial ports. Use current Chrome or Microsoft Edge on the computer the instrument is plugged into. You can still view saved readings here.',
    };
  }
  return { ok: true };
}

function describe(port: SerialPort): string {
  const info = port.getInfo();
  if (info.usbVendorId !== undefined) {
    const hex = (n?: number) => (n === undefined ? '????' : n.toString(16).padStart(4, '0'));
    return `USB serial adapter (VID ${hex(info.usbVendorId)}, PID ${hex(info.usbProductId)})`;
  }
  return 'Built-in or non-USB serial port';
}

class WebSerialConnection implements SerialConnection {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private closing = false;
  private loop: Promise<void> | null = null;
  readonly description: string;

  constructor(private port: SerialPort) {
    this.description = describe(port);
  }

  async *chunks(): AsyncIterable<Uint8Array> {
    let finished!: () => void;
    this.loop = new Promise((r) => (finished = r));
    try {
      while (this.port.readable && !this.closing) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value?.length) yield value;
          }
        } catch (e) {
          if (this.closing) break;
          const name = (e as DOMException)?.name;
          // Framing/parity/break/overrun errors are recoverable: the stream is re-created.
          if (name === 'NetworkError') throw new SerialFailure('unplugged', 'The instrument stopped responding (unplugged or the adapter was removed).');
          if (!['BreakError', 'FramingError', 'ParityError', 'BufferOverrunError'].includes(name)) {
            throw new SerialFailure('read_failed', `Reading the port failed: ${(e as Error).message}`);
          }
        } finally {
          this.reader?.releaseLock();
          this.reader = null;
        }
      }
      if (!this.closing && !this.port.readable) {
        throw new SerialFailure('unplugged', 'The serial port closed unexpectedly (unplugged?).');
      }
    } finally {
      finished();
    }
  }

  async close() {
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      // already released
    }
    await this.loop;
    try {
      await this.port.close();
    } catch {
      // already closed or unplugged
    }
  }

}

async function openPort(port: SerialPort): Promise<SerialConnection> {
  try {
    await port.open(AIO2_SERIAL_OPTIONS);
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'InvalidStateError') throw new SerialFailure('already_open', 'This port is already open in this browser. Close other tabs using it.');
    if (name === 'NetworkError') {
      throw new SerialFailure('busy', 'The port could not be opened. Another program (Comet, PuTTY, a data logger) may be using it. Close that program and try again.');
    }
    throw new SerialFailure('open_failed', `The port could not be opened: ${(e as Error).message}`);
  }
  return new WebSerialConnection(port);
}

/** Must be called from a click handler: shows the browser's native port chooser. */
export async function requestAndOpen(): Promise<SerialConnection> {
  let port: SerialPort;
  try {
    port = await navigator.serial.requestPort();
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'NotFoundError') throw new SerialFailure('cancelled', 'No port was selected.');
    if (name === 'SecurityError') throw new SerialFailure('blocked', 'Serial access is blocked by the browser or site settings.');
    throw new SerialFailure('open_failed', (e as Error).message);
  }
  return openPort(port);
}

/** Ports this site was granted earlier; reopening them shows no chooser. */
export async function grantedPorts(): Promise<SerialPort[]> {
  if (!('serial' in navigator)) return [];
  try {
    return await navigator.serial.getPorts();
  } catch {
    return [];
  }
}

export async function reopen(port: SerialPort): Promise<SerialConnection> {
  return openPort(port);
}

export function describePort(port: SerialPort) {
  return describe(port);
}

