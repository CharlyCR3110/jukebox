/**
 * Zone instruments: each location gets its own timbre so places can be told apart by ear.
 *
 * This is an IDENTITY cue chosen by design, not derived from data. Pitch, glide and pulses
 * (mapping.ts) are identical for every voice; only the tone colour changes. The fundamental
 * of every voice is the mapped frequency, so "24 °C → 673 Hz" still holds.
 *
 * Pure description only (no Tone.js here), so it is testable and the UI can list it.
 */
export type VoiceKind = 'triangle' | 'mallet' | 'pluck' | 'brass' | 'bell' | 'breath';

export interface VoiceDef {
  kind: VoiceKind;
  /** Short name shown in the UI and spoken in the text description. */
  name: string;
  /** Why this sound fits this zone (shown in "What am I hearing?"). */
  why: string;
  /**
   * Level trim (dB) so voices are about equally loud. Calibrated in the browser by matching each
   * voice's loudest 21 ms RMS window to the uniform tone at 330 and 660 Hz (2026-11-14).
   */
  trimDb: number;
}

export const UNIFORM_VOICE: VoiceDef = {
  kind: 'triangle',
  name: 'uniform tone',
  why: 'The same plain tone for every location, so only the data cues differ.',
  trimDb: 0,
};

export const ZONE_VOICES: Record<string, VoiceDef> = {
  wpwp: {
    kind: 'mallet',
    name: 'soft mallet',
    why: 'The warmest open ocean on Earth, calm and steady: a round, warm mallet.',
    trimDb: 8.5,
  },
  nino34: {
    kind: 'pluck',
    name: 'wooden pluck',
    why: 'The El Niño monitoring box, the “heartbeat” of tropical climate: a dry, rhythmic pluck.',
    trimDb: -3,
  },
  gulf: {
    kind: 'brass',
    name: 'brass',
    why: 'A warm, shallow basin that fuels hurricanes: a bright, energetic brass.',
    trimDb: -1,
  },
  natl: {
    kind: 'bell',
    name: 'glass bell',
    why: 'Cold, clear water with the largest seasonal swing of the five zones: a glassy bell.',
    trimDb: 8.5,
  },
  so: {
    kind: 'breath',
    name: 'breathy wind',
    why: 'The windiest, coldest open ocean: an airy tone with wind noise.',
    trimDb: -2,
  },
};

export function voiceFor(locationId: string, zoneVoices: boolean): VoiceDef {
  if (!zoneVoices) return UNIFORM_VOICE;
  return ZONE_VOICES[locationId] ?? UNIFORM_VOICE;
}
