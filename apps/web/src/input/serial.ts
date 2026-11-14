/**
 * ESP32 controller adapter over Web Serial (spec §8, P1).
 * Protocol: 115200 baud, newline-delimited JSON, one intent per line, e.g. {"type":"NEXT_FRAME"}.
 * Every line is validated and rate-limited; bad input is dropped, never thrown at the app.
 */
import { EXTERNAL_INTENTS, type Intent } from '../state/store';

export const BAUD_RATE = 115200;
export const MAX_EVENTS_PER_SECOND = 20;
const MAX_LINE = 256;

/** Minimal Web Serial typings (not yet in lib.dom). */
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  addEventListener(t: 'disconnect', cb: (e: Event) => void): void;
}

export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

/** Parse one line into an intent, or null if it is not a valid, allowed message. */
export function parseLine(line: string): Intent | null {
  const s = line.trim();
  if (!s || s.length > MAX_LINE) return null;
  let msg: unknown;
  try { msg = JSON.parse(s); } catch { return null; }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== 'string' || !EXTERNAL_INTENTS.has(m.type)) return null;
  switch (m.type) {
    case 'SET_FRAME':
      return Number.isInteger(m.index) ? { type: 'SET_FRAME', index: m.index as number } : null;
    case 'SELECT_LOCATION':
      return typeof m.id === 'string' && m.id.length <= 32 ? { type: 'SELECT_LOCATION', id: m.id } : null;
    case 'ADJUST_LOCATION':
      return m.direction === 1 || m.direction === -1 ? { type: 'ADJUST_LOCATION', direction: m.direction } : null;
    case 'SET_VOLUME':
      return typeof m.value === 'number' && Number.isFinite(m.value) ? { type: 'SET_VOLUME', value: m.value } : null;
    default:
      return { type: m.type } as Intent;
  }
}

/** Sliding one-second window limiter. */
export function rateLimiter(max = MAX_EVENTS_PER_SECOND, now = () => performance.now()) {
  const hits: number[] = [];
  return () => {
    const t = now();
    while (hits.length && t - hits[0] > 1000) hits.shift();
    if (hits.length >= max) return false;
    hits.push(t);
    return true;
  };
}

export interface SerialConnection {
  close(): Promise<void>;
}

export async function connectSerial(
  dispatch: (i: Intent) => void,
  onStatus: (connected: boolean, message?: string) => void,
): Promise<SerialConnection | null> {
  if (!serialSupported()) {
    onStatus(false, 'Web Serial is not supported in this browser. Use Chrome or Edge on desktop.');
    return null;
  }
  const serial = (navigator as unknown as { serial: SerialLike }).serial;
  let port: SerialPortLike;
  try {
    port = await serial.requestPort();
    await port.open({ baudRate: BAUD_RATE });
  } catch (e) {
    onStatus(false, (e as Error).name === 'NotFoundError' ? 'No controller selected.' : `Could not open controller: ${(e as Error).message}`);
    return null;
  }
  onStatus(true);
  let closed = false;
  const allow = rateLimiter();
  const reader = port.readable!.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();

  (async () => {
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        if (buf.length > MAX_LINE * 8) buf = buf.slice(-MAX_LINE);
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const intent = parseLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          if (intent && allow()) dispatch(intent);
        }
      }
    } catch {
      /* device unplugged */
    } finally {
      if (!closed) onStatus(false, 'Controller disconnected. On-screen controls still work.');
      closed = true;
      try { reader.releaseLock(); await port.close(); } catch { /* already closed */ }
    }
  })();

  return {
    async close() {
      closed = true;
      try { await reader.cancel(); } catch { /* ignore */ }
      onStatus(false);
    },
  };
}
