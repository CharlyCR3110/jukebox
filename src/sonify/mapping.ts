/**
 * Data → sound mapping (the "artistic ruleset").
 *   temperature anomaly   → pitch      (higher = warmer), snapped to a musical scale
 *   change since last frame → pulse rate (faster = quicker change)
 *   spatial spread         → noise grain (rougher = more varied)
 */
import { neighbourhood, sample, type FrameData } from '../data/frames';

export type Probe = [number, number] | null;

export interface Settings {
  /** Pitch span, 1–4 → ±0.5…±2 octaves. */
  span: number;
  /** Rhythm sensitivity 0–100. */
  sens: number;
  /** Texture depth 0–100. */
  depth: number;
}

export interface Sequence {
  mode: 'global' | 'probe';
  values: number[];
  anoms: number[];
  rates: number[];
  spreads: number[];
  /** True where the probe has no ocean value in that frame. */
  land: boolean[];
  anomMax: number;
  rateMax: number;
  sMin: number;
  sMax: number;
}

export interface Voice {
  freq: number;
  pulses: number;
  grain: number;
}

export interface Reading extends Voice {
  mode: 'global' | 'probe';
  land: boolean;
  value: number;
  anom: number;
  rate: number;
  spread: number;
  pn: number;
  gn: number;
  spanOct: number;
  seq: Sequence;
}

export const ROOT_HZ = 261.63; // C4
/** Major pentatonic: consonant whichever notes the data lands on. */
export const SCALE = [0, 2, 4, 7, 9];
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const signed = (v: number, d: number) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(d);
const deg = (v: number) => (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1));
export const fmtLat = (l: number) => `${deg(Math.abs(l))}°${l >= 0 ? 'N' : 'S'}`;
export const fmtLon = (l: number) => (l === 0 ? '0°' : `${deg(Math.abs(l))}°${l > 0 ? 'E' : 'W'}`);
export const noteName = (f: number) => {
  const m = Math.round(69 + 12 * Math.log2(f / 440));
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
};

const maxAbs = (xs: number[], floor: number) => Math.max(floor, ...xs.map((x) => Math.abs(x)));
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  if (!xs.length) return 0;
  const m = avg(xs);
  return Math.sqrt(avg(xs.map((x) => (x - m) ** 2)));
};

/** Snap a semitone offset to the nearest degree of SCALE. */
export function quantize(semis: number): number {
  const oct = Math.floor(semis / 12);
  let best = 0, bestD = Infinity;
  for (const o of [oct - 1, oct, oct + 1]) {
    for (const s of SCALE) {
      const cand = o * 12 + s;
      const d = Math.abs(cand - semis);
      if (d < bestD) { bestD = d; best = cand; }
    }
  }
  return best;
}

export function globalSequence(frames: FrameData[]): Sequence {
  const values = frames.map((f) => f.mean);
  const m = avg(values);
  const anoms = values.map((v) => v - m);
  const rates = values.map((v, i) => v - values[(i + values.length - 1) % values.length]);
  const spreads = frames.map((f) => f.std);
  const lo = Math.min(...spreads), hi = Math.max(...spreads);
  const pad = Math.max(0.05, (hi - lo) * 0.1);
  return {
    mode: 'global', values, anoms, rates, spreads, land: values.map(() => false),
    anomMax: maxAbs(anoms, 0.05), rateMax: maxAbs(rates, 0.05), sMin: lo - pad, sMax: hi + pad,
  };
}

export function probeSequence(frames: FrameData[], [lat, lon]: [number, number]): Sequence {
  const raw = frames.map((f) => sample(f.grid, lat, lon));
  const land = raw.map((v) => Number.isNaN(v));
  const valid = raw.filter((v) => !Number.isNaN(v));
  const m = valid.length ? avg(valid) : 0;
  const values = raw.map((v) => (Number.isNaN(v) ? m : v));
  const anoms = values.map((v) => v - m);
  const rates = values.map((v, i) => v - values[(i + 11) % 12]);
  const spreads = frames.map((f) => sd(neighbourhood(f.grid, lat, lon, 2.5)));
  return {
    mode: 'probe', values, anoms, rates, spreads, land,
    anomMax: maxAbs(anoms, 0.1), rateMax: maxAbs(rates, 0.1), sMin: 0, sMax: 3,
  };
}

export function voiceFor(seq: Sequence, f: number, s: Settings) {
  const spanOct = s.span / 2;
  const pn = clamp(seq.anoms[f] / seq.anomMax, -1, 1);
  const freq = ROOT_HZ * Math.pow(2, quantize(pn * spanOct * 12) / 12);
  const rn = clamp(Math.abs(seq.rates[f]) / seq.rateMax, 0, 1);
  const pulses = clamp(0.5 + rn * 6 * (s.sens / 50), 0.5, 8);
  const gn = clamp((seq.spreads[f] - seq.sMin) / (seq.sMax - seq.sMin), 0, 1);
  return { freq, pulses, grain: gn * (s.depth / 100), pn, gn, spanOct };
}

/** Reading for one frame. A probe on land falls back to the global mean. */
export function readingFor(global: Sequence, probe: Sequence | null, f: number, s: Settings): Reading {
  const onLand = !!probe && probe.land[f];
  const seq = probe && !onLand ? probe : global;
  return {
    ...voiceFor(seq, f, s),
    mode: seq.mode, land: onLand, seq,
    value: seq.values[f], anom: seq.anoms[f], rate: seq.rates[f], spread: seq.spreads[f],
  };
}

/** One voice per frame, for transport scheduling and offline export. */
export function voicesFor(global: Sequence, probe: Sequence | null, s: Settings): Voice[] {
  return global.values.map((_, f) => {
    const r = readingFor(global, probe, f, s);
    return { freq: r.freq, pulses: r.pulses, grain: r.grain };
  });
}

export function describe(r: Reading, frames: FrameData[], f: number, probe: Probe): string {
  const F = frames[f];
  const when = `${F.long.charAt(0)}${F.long.slice(1).toLowerCase()} ${F.date.slice(0, 4)} (frame ${f + 1} of 12).`;
  const dir = r.rate > 0.02 ? 'warming' : r.rate < -0.02 ? 'cooling' : 'holding steady';
  if (r.mode === 'probe' && probe) {
    return `${when} Probe at ${fmtLat(probe[0])} ${fmtLon(probe[1])}: ${r.value.toFixed(1)} °C, ${signed(r.anom, 1)} °C against this point’s 12-frame average, ${dir} by ${Math.abs(r.rate).toFixed(1)} °C since the previous frame. Nearby values spread ${r.spread.toFixed(1)} °C. You hear ${noteName(r.freq)}, ${r.pulses.toFixed(1)} pulses per second.`;
  }
  const sorted = [...r.seq.anoms].sort((a, b) => a - b);
  const rank = r.anom === sorted[0] ? ' The coolest frame in this sequence.' : r.anom === sorted[11] ? ' The warmest frame in this sequence.' : '';
  let best = -Infinity, bestLat = 0;
  for (let b = 6; b < 30; b++) {
    const v = F.bands[b];
    if (!Number.isNaN(v) && v > best) { best = v; bestLat = 90 - b * 5 - 2.5; }
  }
  const band = Number.isFinite(best) ? ` The warmest band is centred near ${fmtLat(bestLat)}.` : '';
  const prefix = probe && r.land ? 'The probe is on land, so this is the global ocean mean. ' : '';
  return `${when} ${prefix}Global ocean mean ${r.value.toFixed(1)} °C, ${signed(r.anom, 2)} °C against the sequence average, ${dir} (${signed(r.rate, 2)} °C since the previous frame).${rank}${band}`;
}
