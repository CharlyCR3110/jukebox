/**
 * Real-time synthesis with Tone.js (spec §7).
 *
 *   Synth (triangle, 30 ms attack / 80 ms release) → gate → Volume → Limiter(−3 dB) → out
 *                                                                     └→ FFT (level meter)
 * One observation = one window of `interval` seconds containing `pulses` notes at the
 * mapped frequency. The first note glides up or down 3 semitones for rising/falling change.
 * The gate closes within 30 ms on Pause, so nothing sounds after Pause.
 */
import * as Tone from 'tone';
import type { SoundCue } from './mapping';

const GLIDE_SEMITONES = 3;
const GLIDE_S = 0.12;
const BASE_DB = -8;

export class AudioEngine {
  private synth?: Tone.Synth;
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
    return !!this.synth;
  }

  /** Creates/resumes the AudioContext. Call only from a user gesture (no autoplay). */
  ensure(): Promise<boolean> {
    if (this.synth) return Tone.start().then(() => true, () => false);
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
    const oldSynth = this.synth, oldGain = this.voiceGain;
    if (oldGain) {
      oldGain.gain.cancelScheduledValues(Tone.immediate());
      oldGain.gain.setTargetAtTime(0, Tone.immediate(), 0.004);
      setTimeout(() => { oldSynth?.dispose(); oldGain.dispose(); }, 80);
    }
    this.voiceGain = new Tone.Gain(1).connect(this.gate!);
    this.synth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.03, decay: 0.05, sustain: 0.8, release: 0.08 },
      volume: BASE_DB,
    }).connect(this.voiceGain);
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
    if (!this.synth || cue.frequencyHz === null || cue.pulses < 1) return;
    const f = cue.frequencyHz;
    const step = interval / cue.pulses;
    const dur = Math.max(0.05, Math.min(0.22, step * 0.55));
    for (let k = 0; k < cue.pulses; k++) {
      const t = time + k * step;
      if (k === 0 && (cue.direction === 'rising' || cue.direction === 'falling')) {
        const from = f * Math.pow(2, (cue.direction === 'rising' ? -GLIDE_SEMITONES : GLIDE_SEMITONES) / 12);
        this.synth.triggerAttackRelease(from, Math.max(dur, GLIDE_S + 0.03), t);
        this.synth.frequency.exponentialRampToValueAtTime(f, t + GLIDE_S);
      } else {
        this.synth.triggerAttackRelease(f, dur, t);
      }
    }
  }

  /**
   * Start playback. `current` sounds immediately; then every `interval` s `next(time)` is
   * called on the audio clock and must return the cue of the observation it advanced to.
   */
  play(current: SoundCue, interval: number, next: (time: number) => SoundCue) {
    if (!this.synth || !this.gate) return;
    const transport = Tone.getTransport();
    this.clear();
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
    [this.synth, this.voiceGain, this.gate, this.vol, this.limiter, this.fft, this.wave].forEach((n) => n?.dispose());
    this.synth = undefined;
    this.starting = undefined;
  }
}
