/**
 * Single authoritative state (spec §6). Mouse, keyboard and the serial controller all
 * dispatch the same intents; audio, map and text render from this state.
 */
export type Speed = 1 | 2;

export interface AppState {
  frameIndex: number;
  frameCount: number;
  locationId: string;
  locationIds: string[];
  playing: boolean;
  muted: boolean;
  /** 0–1 */
  volume: number;
  speed: Speed;
  controllerConnected: boolean;
}

export type Intent =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'TOGGLE_PLAY' }
  | { type: 'NEXT_FRAME' }
  | { type: 'PREV_FRAME' }
  | { type: 'SET_FRAME'; index: number }
  | { type: 'SELECT_LOCATION'; id: string }
  | { type: 'ADJUST_LOCATION'; direction: 1 | -1 }
  | { type: 'SET_VOLUME'; value: number }
  | { type: 'MUTE' }
  | { type: 'UNMUTE' }
  | { type: 'SET_SPEED'; speed: Speed }
  | { type: 'CONTROLLER'; connected: boolean }
  | { type: 'INIT'; frameCount: number; locationIds: string[] };

/** Intents accepted from external controllers (serial). */
export const EXTERNAL_INTENTS = new Set([
  'PLAY', 'PAUSE', 'TOGGLE_PLAY', 'NEXT_FRAME', 'PREV_FRAME', 'SET_FRAME',
  'SELECT_LOCATION', 'ADJUST_LOCATION', 'SET_VOLUME', 'MUTE', 'UNMUTE',
]);

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrap = (i: number, n: number) => ((i % n) + n) % n;

export function initialState(saved?: Partial<Pick<AppState, 'muted' | 'volume'>>): AppState {
  return {
    frameIndex: 0,
    frameCount: 0,
    locationId: '',
    locationIds: [],
    playing: false,
    muted: saved?.muted ?? false,
    volume: clamp(saved?.volume ?? 0.4, 0, 1),
    speed: 1,
    controllerConnected: false,
  };
}

export function reducer(s: AppState, a: Intent): AppState {
  switch (a.type) {
    case 'INIT':
      return {
        ...s,
        frameCount: a.frameCount,
        locationIds: a.locationIds,
        frameIndex: clamp(s.frameIndex, 0, Math.max(0, a.frameCount - 1)),
        locationId: a.locationIds.includes(s.locationId) ? s.locationId : a.locationIds[0] ?? '',
      };
    case 'PLAY':
      return s.frameCount ? { ...s, playing: true } : s;
    case 'PAUSE':
      return { ...s, playing: false };
    case 'TOGGLE_PLAY':
      return reducer(s, { type: s.playing ? 'PAUSE' : 'PLAY' });
    case 'NEXT_FRAME':
      return s.frameCount ? { ...s, frameIndex: wrap(s.frameIndex + 1, s.frameCount) } : s;
    case 'PREV_FRAME':
      return s.frameCount ? { ...s, frameIndex: wrap(s.frameIndex - 1, s.frameCount) } : s;
    case 'SET_FRAME':
      return Number.isInteger(a.index) && s.frameCount ? { ...s, frameIndex: clamp(a.index, 0, s.frameCount - 1) } : s;
    case 'SELECT_LOCATION':
      return s.locationIds.includes(a.id) ? { ...s, locationId: a.id } : s;
    case 'ADJUST_LOCATION': {
      if (!s.locationIds.length) return s;
      const i = s.locationIds.indexOf(s.locationId);
      return { ...s, locationId: s.locationIds[wrap(i + a.direction, s.locationIds.length)] };
    }
    case 'SET_VOLUME':
      return Number.isFinite(a.value) ? { ...s, volume: clamp(a.value, 0, 1) } : s;
    case 'MUTE':
      return { ...s, muted: true };
    case 'UNMUTE':
      return { ...s, muted: false };
    case 'SET_SPEED':
      return a.speed === 1 || a.speed === 2 ? { ...s, speed: a.speed } : s;
    case 'CONTROLLER':
      return { ...s, controllerConnected: a.connected };
    default:
      return s;
  }
}

/** Seconds per observation at the current speed (spec §7: 1 s at 1×, halved at 2×). */
export const frameInterval = (speed: Speed) => 1 / speed;
