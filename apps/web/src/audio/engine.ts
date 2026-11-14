/**
 * Real-time synthesis with Tone.js (spec §7).
 *
 *   zone instrument (voices.ts) → voiceGain → gate → Volume → Limiter(−3 dB) → out
 *                                                                  └→ FFT / Waveform taps
 * The instrument only sets tone colour; its fundamental is always the mapped frequency.
 * One observation = one window of `interval` seconds containing `pulses` notes at the
 * mapped frequency. The first note glides up or down 3 semitones for rising/falling change.
 * The gate closes within 30 ms on Pause, so nothing sounds after Pause.
 */
import * as Tone from 'tone';
import type { SoundCue } from './mapping';
import { UNIFORM_VOICE, type VoiceDef } from './voices';

const GLIDE_SEMITONES = 3;
const GLIDE_S = 0.12;
const BASE_DB = -8;


interface Instrument {
  /** One note at `freq`; when `from` is given the note glides from → freq over GLIDE_S. */
  note(freq: number, dur: number, time: number, from?: number): void;
  dispose(): void;
}

type Mono = Tone.Synth | Tone.FMSynth | Tone.MonoSynth;

function monoNote(s: Mono, freq: number, dur: number, time: number, from?: number) {
  if (from) {
    s.triggerAttackRelease(from, Math.max(dur, GLIDE_S + 0.03), time);
    s.frequency.exponentialRampToValueAtTime(freq, time + GLIDE_S);
  } else {
    s.triggerAttackRelease(freq, dur, time);
  }
}

/** Build the Tone.js instrument for a voice. Every voice's fundamental = the note frequency. */
function buildInstrument(def: VoiceDef, out: Tone.InputNode): Instrument {
  const volume = BASE_DB + def.trimDb;
  const mono = (s: Mono): Instrument => {
    s.connect(out);
    return { note: (f, d, t, from) => monoNote(s, f, d, t, from), dispose: () => s.dispose() };
  };
  switch (def.kind) {
    case 'mallet':
      return mono(new Tone.FMSynth({
        volume, harmonicity: 1, modulationIndex: 1.6,
        oscillator: { type: 'sine' }, modulation: { type: 'sine' },
        envelope: { attack: 0.005, decay: 0.35, sustain: 0.2, release: 0.35 },
        modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0.1, release: 0.2 },
      }));
    case 'pluck':
      return mono(new Tone.MonoSynth({
        volume, oscillator: { type: 'square' },
        filter: { type: 'lowpass', Q: 1, rolloff: -24 },
        // decay long enough (> GLIDE_S) that the rising/falling glide stays audible
        envelope: { attack: 0.002, decay: 0.35, sustain: 0.12, release: 0.1 },
        filterEnvelope: { attack: 0.001, decay: 0.22, sustain: 0.15, release: 0.08, baseFrequency: 300, octaves: 3.5 },
      }));
    case 'brass':
      return mono(new Tone.MonoSynth({
        volume, oscillator: { type: 'sawtooth' },
        filter: { type: 'lowpass', Q: 2, rolloff: -24 },
        envelope: { attack: 0.04, decay: 0.1, sustain: 0.75, release: 0.12 },
        filterEnvelope: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 0.2, baseFrequency: 400, octaves: 2.5 },
      }));
    case 'bell':
      return mono(new Tone.FMSynth({
        volume, harmonicity: 3, modulationIndex: 5,
        oscillator: { type: 'sine' }, modulation: { type: 'sine' },
        envelope: { attack: 0.002, decay: 0.8, sustain: 0, release: 0.6 },
        modulationEnvelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.3 },
      }));
    case 'breath': {
      const env = { attack: 0.06, decay: 0.1, sustain: 0.7, release: 0.25 };
      const tone = new Tone.Synth({ volume, oscillator: { type: 'sine' }, envelope: env }).connect(out);
      const band = new Tone.Filter({ type: 'bandpass', Q: 4 }).connect(out);
      const wind = new Tone.NoiseSynth({ volume: volume - 4, noise: { type: 'pink' }, envelope: env }).connect(band);
      return {
        note(f, d, t, from) {
          monoNote(tone, f, d, t, from);
          band.frequency.setValueAtTime(from ?? f, t);
          if (from) band.frequency.exponentialRampToValueAtTime(f, t + GLIDE_S);
          wind.triggerAttackRelease(from ? Math.max(d, GLIDE_S + 0.03) : d, t);
        },
        dispose() { tone.dispose(); wind.dispose(); band.dispose(); },
      };
    }
    default:
      return mono(new Tone.Synth({
        volume, oscillator: { type: 'triangle' },
        envelope: { attack: 0.03, decay: 0.05, sustain: 0.8, release: 0.08 },
      }));
  }
}

export class AudioEngine {
  private inst?: Instrument;
  private voice: VoiceDef = UNIFORM_VOICE;
  private gate?: Tone.Gain;
  private vol?: Tone.Volume;
  private limiter?: Tone.Limiter;
  private fft?: Tone.FFT;
  private wave?: Tone.Waveform;
  private repeatId?: number;
  private starting?: Promise<boolean>;
  /** Counters for diagnostics and tests. */
  readonly debug = { plays: 0, ticks: 0, lastError: '' };

  get ready() {
    return !!this.inst;
  }

  /** Creates/resumes the AudioContext. Call only from a user gesture (no autoplay). */
  ensure(): Promise<boolean> {
    if (this.inst) return Tone.start().then(() => true, () => false);
    this.starting ??= (async () => {
      try {
        await Tone.start();
        this.limiter = new Tone.Limiter(-3).toDestination();
        this.vol = new Tone.Volume(-100).connect(this.limiter);
        this.fft = new Tone.FFT(64);
        this.limiter.connect(this.fft);
        this.wave = new Tone.Waveform(1024);
        this.limiter.connect(this.wave);
        this.gate = new Tone.Gain(0).connect(this.vol);
        this.newVoice();
        return true;
      } catch {
        this.starting = undefined;
        return false;
      }
    })();
    return this.starting;
  }

  private voiceGain?: Tone.Gain;

  /**
   * Fade out the current voice and replace it with a fresh one. This drops every note
   * already queued ahead on the audio clock (Tone's monophonic synth cannot unschedule),
   * so restarts and Pause take effect immediately.
   */
  private newVoice() {
    const oldInst = this.inst, oldGain = this.voiceGain;
    if (oldGain) {
      oldGain.gain.cancelScheduledValues(Tone.immediate());
      oldGain.gain.setTargetAtTime(0, Tone.immediate(), 0.004);
      setTimeout(() => { oldInst?.dispose(); oldGain.dispose(); }, 80);
    }
    this.voiceGain = new Tone.Gain(1).connect(this.gate!);
    this.inst = buildInstrument(this.voice, this.voiceGain);
  }

  setOutput(volume: number, muted: boolean) {
    if (!this.vol) return;
    const db = muted || volume <= 0 ? -Infinity : Tone.gainToDb(volume);
    const now = Tone.immediate();
    this.vol.volume.cancelScheduledValues(now);
    this.vol.volume.setValueAtTime(this.vol.volume.getValueAtTime(now), now);
    this.vol.volume.linearRampToValueAtTime(db === -Infinity ? -100 : db, now + 0.04);
  }

  /** Schedule one observation's notes in [time, time + interval). */
  private render(cue: SoundCue, time: number, interval: number) {
    if (!this.inst || cue.frequencyHz === null || cue.pulses < 1) return;
    const f = cue.frequencyHz;
    const step = interval / cue.pulses;
    const dur = Math.max(0.05, Math.min(0.22, step * 0.55));
    for (let k = 0; k < cue.pulses; k++) {
      const glide = k === 0 && (cue.direction === 'rising' || cue.direction === 'falling');
      const from = glide ? f * Math.pow(2, (cue.direction === 'rising' ? -GLIDE_SEMITONES : GLIDE_SEMITONES) / 12) : undefined;
      this.inst.note(f, dur, time + k * step, from);
    }
  }

  /**
   * Start playback. `current` sounds immediately; then every `interval` s `next(time)` is
   * called on the audio clock and must return the cue of the observation it advanced to.
   * `voice` is the zone instrument (tone colour only).
   */
  play(current: SoundCue, interval: number, next: (time: number) => SoundCue, voice: VoiceDef = UNIFORM_VOICE) {
    if (!this.inst || !this.gate) return;
    const transport = Tone.getTransport();
    this.clear();
    this.voice = voice;
    this.newVoice();
    const now = Tone.now() + 0.02;
    this.gate.gain.cancelScheduledValues(Tone.now());
    this.gate.gain.setTargetAtTime(1, Tone.now(), 0.01);
    this.render(current, now, interval);
    this.debug.plays++;
    this.repeatId = transport.scheduleRepeat((time) => {
      this.debug.ticks++;
      try {
        this.render(next(time), time, interval);
      } catch (e) {
        this.debug.lastError = String(e);
        console.error('Earth Jukebox: playback tick failed', e);
      }
    }, interval, transport.seconds + interval);
    if (transport.state !== 'started') transport.start();
  }

  stop() {
    this.clear();
    Tone.getTransport().stop();
    if (this.gate) {
      const now = Tone.immediate(); // act now, not after the scheduling lookahead
      this.gate.gain.cancelScheduledValues(now);
      this.gate.gain.setTargetAtTime(0, now, 0.01); // ~30 ms to silence
      this.newVoice(); // drop notes queued ahead
    }
  }

  private clear() {
    if (this.repeatId !== undefined) Tone.getTransport().clear(this.repeatId);
    this.repeatId = undefined;
  }

  levels(): number[] {
    if (!this.fft) return new Array(24).fill(0);
    const db = this.fft.getValue();
    return Array.from({ length: 24 }, (_, i) => Math.max(0, Math.min(1, (db[i + 1] + 100) / 70)));
  }

  /** Instantaneous output peak (0–1), unsmoothed. Used to verify silence after Pause. */
  peak(): number {
    if (!this.wave) return 0;
    let m = 0;
    for (const v of this.wave.getValue()) m = Math.max(m, Math.abs(v));
    return m;
  }

  dispose() {
    this.stop();
    [this.voiceGain, this.gate, this.vol, this.limiter, this.fft, this.wave].forEach((n) => n?.dispose());
    this.inst?.dispose();
    this.inst = undefined;
    this.starting = undefined;
  }
}
