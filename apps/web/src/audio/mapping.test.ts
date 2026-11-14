import { describe as suite, expect, it } from 'vitest';
import { cueFor, describe, directionForDelta, frequencyForSst, pulsesForDelta } from './mapping';
import type { PointObservation } from '../data/manifest';

const pt = (sstC: number | null, deltaC: number | null, isValid = sstC !== null): PointObservation => ({ lat: 0, lon: 0, sstC, deltaC, isValid });

suite('pitch (spec §7: Hz = 220 + clamp(°C,0,35)/35 × 660)', () => {
  it('matches the spec example: 24.0 °C → 673 Hz', () => {
    expect(Math.round(frequencyForSst(24).hz)).toBe(673);
  });
  it('maps the range ends exactly', () => {
    expect(frequencyForSst(0).hz).toBe(220);
    expect(frequencyForSst(35).hz).toBe(880);
  });
  it('warmer water gives a higher frequency', () => {
    expect(frequencyForSst(26.5).hz).toBeGreaterThan(frequencyForSst(17.1).hz);
  });
  it('clamps and flags values outside 0–35 °C', () => {
    expect(frequencyForSst(-1.2)).toEqual({ hz: 220, clamped: true });
    expect(frequencyForSst(36)).toEqual({ hz: 880, clamped: true });
    expect(frequencyForSst(10).clamped).toBe(false);
  });
});

suite('change cues', () => {
  it('rising, falling, unchanged and missing are distinct', () => {
    expect(directionForDelta(0.4)).toBe('rising');
    expect(directionForDelta(-0.4)).toBe('falling');
    expect(directionForDelta(0.01)).toBe('unchanged');
    expect(directionForDelta(null)).toBe('unavailable');
  });
  it('pulses grow 1 → 5 with |Δ| and cap at 2 °C', () => {
    expect(pulsesForDelta(0).pulses).toBe(1);
    expect(pulsesForDelta(0.5).pulses).toBe(2);
    expect(pulsesForDelta(-1).pulses).toBe(3);
    expect(pulsesForDelta(2).pulses).toBe(5);
    expect(pulsesForDelta(3.1)).toEqual({ pulses: 5, capped: true });
  });
});

suite('cueFor', () => {
  it('is deterministic for the same observation', () => {
    expect(cueFor(pt(24, 0.4), 'measured_sst')).toEqual(cueFor(pt(24, 0.4), 'measured_sst'));
  });
  it('is silent for invalid / missing data and never invents a value', () => {
    const c = cueFor(pt(null, null, false), 'measured_sst');
    expect(c.frequencyHz).toBeNull();
    expect(c.pulses).toBe(0);
    expect(c.silentReason).toMatch(/silent/i);
    expect(cueFor(undefined, 'measured_sst').frequencyHz).toBeNull();
  });
  it('disables the direction cue when deltaC is unavailable', () => {
    const c = cueFor(pt(24, null), 'measured_sst');
    expect(c.direction).toBe('unavailable');
    expect(c.frequencyHz).not.toBeNull();
  });
  it('visual_feature mode uses the feature, not sstC', () => {
    const p: PointObservation = { lat: 0, lon: 0, sstC: null, deltaC: null, isValid: true, feature: 0, featureDelta: 0.1 };
    const c = cueFor(p, 'visual_feature');
    expect(c.frequencyHz).toBe(550);
    expect(c.direction).toBe('rising');
  });
});

suite('describe', () => {
  it('states value, change and sound for a valid observation', () => {
    const p = pt(24, 0.4);
    const text = describe({ mode: 'measured_sst', date: '2026-07-15', frameNumber: 9, frameCount: 12, locationName: 'Gulf', p, days: 30, cue: cueFor(p, 'measured_sst') });
    expect(text).toContain('24.00 °C');
    expect(text).toContain('+0.40 °C');
    expect(text).toContain('673 Hz');
    expect(text).toContain('upward glide');
  });
  it('labels visual_feature values as not a temperature', () => {
    const p: PointObservation = { lat: 0, lon: 0, sstC: null, deltaC: null, isValid: true, feature: 0.3, featureDelta: null };
    const text = describe({ mode: 'visual_feature', date: '2026-07-15', frameNumber: 1, frameCount: 12, locationName: 'X', p, days: null, cue: cueFor(p, 'visual_feature') });
    expect(text).toMatch(/not a temperature/);
  });
});
