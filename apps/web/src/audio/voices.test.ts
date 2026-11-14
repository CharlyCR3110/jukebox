import { describe, expect, it } from 'vitest';
import { UNIFORM_VOICE, ZONE_VOICES, voiceFor } from './voices';
import { cueFor, describe as describeText } from './mapping';
import { initialState, reducer } from '../state/store';
import type { Manifest, PointObservation } from '../data/manifest';

const shipped = Object.values(import.meta.glob('../../public/data/sst/manifest.json', { eager: true, import: 'default' }))[0] as Manifest;

describe('zone voices', () => {
  it('every shipped location has its own, distinct instrument', () => {
    const kinds = shipped.locations.map((l) => voiceFor(l.id, true).kind);
    expect(kinds).not.toContain(UNIFORM_VOICE.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
  it('falls back to the uniform tone when off or for unknown locations', () => {
    expect(voiceFor('wpwp', false)).toBe(UNIFORM_VOICE);
    expect(voiceFor('somewhere-new', true)).toBe(UNIFORM_VOICE);
  });
  it('every voice explains itself', () => {
    for (const v of Object.values(ZONE_VOICES)) {
      expect(v.name.length).toBeGreaterThan(2);
      expect(v.why.length).toBeGreaterThan(20);
      expect(Math.abs(v.trimDb)).toBeLessThanOrEqual(10);
    }
  });
  it('voice never changes the data cue (pitch, glide, pulses)', () => {
    const p: PointObservation = { lat: 0, lon: 0, sstC: 24, deltaC: 0.4, isValid: true };
    // cueFor has no voice input at all; the description just names the instrument
    const cue = cueFor(p, 'measured_sst');
    const text = describeText({ mode: 'measured_sst', date: '2026-07-15', frameNumber: 1, frameCount: 12, locationName: 'X', p, days: 30, cue, voiceName: 'glass bell' });
    expect(text).toContain('the glass bell at 673 Hz');
  });
  it('SET_ZONE_VOICES toggles state and defaults to on', () => {
    const s = initialState();
    expect(s.zoneVoices).toBe(true);
    expect(reducer(s, { type: 'SET_ZONE_VOICES', on: false }).zoneVoices).toBe(false);
    expect(initialState({ zoneVoices: false }).zoneVoices).toBe(false);
  });
});
