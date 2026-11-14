/**
 * Data → sound mapping (spec §7). Pure and deterministic: the same observation always
 * produces the same cue. Sound settings (volume, mute, speed) never change these values.
 */
import type { DataMode, PointObservation } from '../data/manifest';

export const PITCH = { baseHz: 220, spanHz: 660, minC: 0, maxC: 35 } as const;
/** |ΔC| that maps to the maximum pulse count. Larger changes are capped and flagged. */
export const DELTA_MAX_C = 2.0;
export const PULSES = { min: 1, max: 5 } as const;
/** Changes smaller than this (°C) count as "unchanged". */
export const UNCHANGED_C = 0.05;
/** visual_feature equivalents (red–blue index, unitless). */
export const FEATURE_DELTA_MAX = 0.2;
export const FEATURE_UNCHANGED = 0.005;

export type Direction = 'rising' | 'falling' | 'unchanged' | 'unavailable';

export interface SoundCue {
  /** null → silent (missing data). */
  frequencyHz: number | null;
  direction: Direction;
  pulses: number;
  /** Input outside the mapped range and clamped. */
  pitchClamped: boolean;
  pulsesCapped: boolean;
  silentReason: string | null;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** frequencyHz = 220 + clamp(sstC, 0, 35) / 35 × 660 */
export function frequencyForSst(sstC: number): { hz: number; clamped: boolean } {
  const c = clamp(sstC, PITCH.minC, PITCH.maxC);
  return { hz: PITCH.baseHz + ((c - PITCH.minC) / (PITCH.maxC - PITCH.minC)) * PITCH.spanHz, clamped: c !== sstC };
}

/** visual_feature: red–blue index −1…1 mapped onto the same 220–880 Hz range. */
export function frequencyForFeature(f: number): { hz: number; clamped: boolean } {
  const c = clamp(f, -1, 1);
  return { hz: PITCH.baseHz + ((c + 1) / 2) * PITCH.spanHz, clamped: c !== f };
}

/** 1 pulse for no change … 5 pulses at |Δ| ≥ max. */
export function pulsesForDelta(delta: number | null, max = DELTA_MAX_C): { pulses: number; capped: boolean } {
  if (delta === null) return { pulses: PULSES.min, capped: false };
  const a = Math.abs(delta);
  const n = PULSES.min + Math.round((Math.min(a, max) / max) * (PULSES.max - PULSES.min));
  return { pulses: n, capped: a > max };
}

export function directionForDelta(delta: number | null, threshold = UNCHANGED_C): Direction {
  if (delta === null) return 'unavailable';
  if (Math.abs(delta) < threshold) return 'unchanged';
  return delta > 0 ? 'rising' : 'falling';
}

export function cueFor(p: PointObservation | undefined, mode: DataMode): SoundCue {
  const silent = (reason: string): SoundCue => ({
    frequencyHz: null, direction: 'unavailable', pulses: 0, pitchClamped: false, pulsesCapped: false, silentReason: reason,
  });
  if (!p) return silent('No observation for this location.');
  if (!p.isValid) return silent('No valid ocean observation at this location and date, so it is silent.');

  if (mode === 'measured_sst') {
    if (p.sstC === null) return silent('Temperature missing, so it is silent.');
    const f = frequencyForSst(p.sstC);
    const pl = pulsesForDelta(p.deltaC);
    return { frequencyHz: f.hz, direction: directionForDelta(p.deltaC), pulses: pl.pulses, pitchClamped: f.clamped, pulsesCapped: pl.capped, silentReason: null };
  }
  if (p.feature === null || p.feature === undefined) return silent('Frame feature missing, so it is silent.');
  const f = frequencyForFeature(p.feature);
  const d = p.featureDelta ?? null;
  const pl = pulsesForDelta(d, FEATURE_DELTA_MAX);
  return { frequencyHz: f.hz, direction: directionForDelta(d, FEATURE_UNCHANGED), pulses: pl.pulses, pitchClamped: f.clamped, pulsesCapped: pl.capped, silentReason: null };
}

// ---- text ----------------------------------------------------------------------
export const signed = (v: number, d: number) => (v < 0 ? '−' : v > 0 ? '+' : '±') + Math.abs(v).toFixed(d);
export const fmtLat = (l: number) => `${Math.abs(l).toFixed(l % 1 ? 1 : 0)}°${l >= 0 ? 'N' : 'S'}`;
export const fmtLon = (l: number) => (l === 0 ? '0°' : `${Math.abs(l).toFixed(l % 1 ? 1 : 0)}°${l > 0 ? 'E' : 'W'}`);
export const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

const DIRECTION_SOUND: Record<Direction, string> = {
  rising: 'an upward glide',
  falling: 'a downward glide',
  unchanged: 'a steady onset',
  unavailable: 'no direction cue',
};
export const directionSound = (d: Direction) => DIRECTION_SOUND[d];

export function describe(opts: {
  mode: DataMode;
  date: string;
  frameNumber: number;
  frameCount: number;
  locationName: string;
  p: PointObservation | undefined;
  days: number | null;
  cue: SoundCue;
}): string {
  const { mode, p, cue } = opts;
  const head = `${fmtDate(opts.date)} (observation ${opts.frameNumber} of ${opts.frameCount}), ${opts.locationName}.`;
  if (cue.frequencyHz === null || !p) return `${head} ${cue.silentReason}`;
  const since = opts.days ? ` over ${opts.days} days` : '';
  const sound = `You hear ${Math.round(cue.frequencyHz)} Hz with ${directionSound(cue.direction)} and ${cue.pulses} pulse${cue.pulses > 1 ? 's' : ''}.`;
  if (mode === 'measured_sst' && p.sstC !== null) {
    const change = p.deltaC === null
      ? 'No change is available because this is the first selected observation or the previous one is invalid.'
      : `It changed ${signed(p.deltaC, 2)} °C since the previous selected observation${since}.`;
    return `${head} Sea-surface temperature ${p.sstC.toFixed(2)} °C. ${change} ${sound}`;
  }
  const change = p.featureDelta == null ? 'No previous frame to compare.' : `The index changed ${signed(p.featureDelta, 3)} since the previous frame${since}.`;
  return `${head} Frame red–blue index ${signed(p.feature ?? 0, 3)} (a property of the image colours, not a temperature). ${change} ${sound}`;
}
