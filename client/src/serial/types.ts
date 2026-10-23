// Serial source abstraction: real Web Serial or the simulator.

export interface SerialConnection {
  /** Human-readable description for diagnostics. */
  readonly description: string;
  /** Yields raw byte chunks until closed or the device fails. Throws SerialFailure on fatal errors. */
  chunks(): AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

export type SerialFailureCode =
  | 'unsupported'
  | 'insecure_context'
  | 'embedded'
  | 'cancelled'
  | 'blocked'
  | 'busy'
  | 'already_open'
  | 'open_failed'
  | 'unplugged'
  | 'read_failed'
  | 'another_tab';

export class SerialFailure extends Error {
  constructor(public code: SerialFailureCode, message: string) {
    super(message);
  }
}

/** The documented AIO 2 profile: 9600 baud, 8 data bits, no parity, 1 stop bit, no flow control. */
export const AIO2_SERIAL_OPTIONS: SerialOptions = {
  baudRate: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flowControl: 'none',
  bufferSize: 4096,
};
