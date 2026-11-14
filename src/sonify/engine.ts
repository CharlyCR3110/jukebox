/**
 * Tone.js audio engine. The same voice graph drives live playback and the offline
 * WAV export, so what you download is exactly what you heard.
 *
 *  triangle osc ─ lowpass ─┐
 *                          ├─ pulse gain (× LFO = rhythm) ─ drone gate ─┐
 *  white noise ─ bandpass ─ grain gain ┘                                ├─ reverb ─ out
 *  FM bell (one strike per frame) ──────────────────────────────────────┘
 */
import * as Tone from 'tone';
import { ROOT_HZ, type Voice } from './mapping';

const DRONE_LEVEL = 0.9;

async function buildVoice(out: Tone.InputNode) {
  const reverb = new Tone.Reverb({ decay: 4.5, preDelay: 0.02, wet: 0.3 });
  await reverb.ready;
  const gate = new Tone.Gain(0);
  const pulse = new Tone.Gain(0.55);
  const lfo = new Tone.LFO({ frequency: 2, min: 0.1, max: 1, type: 'sine' });
  const osc = new Tone.Oscillator({ type: 'triangle', frequency: ROOT_HZ });
  const lp = new Tone.Filter({ type: 'lowpass', frequency: 2200 });
  const noise = new Tone.Noise('white');
  const bp = new Tone.Filter({ type: 'bandpass', frequency: ROOT_HZ * 2, Q: 3 });
  const grain = new Tone.Gain(0);
  const bell = new Tone.FMSynth({
    harmonicity: 3.01,
    modulationIndex: 7,
    envelope: { attack: 0.004, decay: 0.9, sustain: 0, release: 1.2 },
    modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.6 },
  });
  bell.volume.value = -14;

  lfo.connect(pulse.gain);
  osc.chain(lp, pulse);
  noise.chain(bp, grain, pulse);
  pulse.chain(gate, reverb);
  bell.connect(reverb);
  reverb.connect(out);

  const nodes = [reverb, gate, pulse, lfo, osc, lp, noise, bp, grain, bell];
  return {
    start(time: number) {
      osc.start(time); noise.start(time); lfo.start(time);
    },
    set(v: Voice, time: number, immediate = false) {
      if (immediate) {
        osc.frequency.setValueAtTime(v.freq, time);
        bp.frequency.setValueAtTime(v.freq * 2, time);
        lfo.frequency.setValueAtTime(v.pulses, time);
        grain.gain.setValueAtTime(v.grain * 0.9, time);
        return;
      }
      osc.frequency.setTargetAtTime(v.freq, time, 0.06);
      bp.frequency.setTargetAtTime(v.freq * 2, time, 0.06);
      lfo.frequency.setTargetAtTime(v.pulses, time, 0.1);
      grain.gain.setTargetAtTime(v.grain * 0.9, time, 0.1);
    },
    gate(on: boolean, time: number) {
      gate.gain.setTargetAtTime(on ? DRONE_LEVEL : 0, time, 0.05);
    },
    ring(freq: number, time: number) {
      bell.triggerAttackRelease(freq * 2, 0.25, time);
    },
    dispose() {
      nodes.forEach((n) => n.dispose());
    },
  };
}

type VoiceGraph = Awaited<ReturnType<typeof buildVoice>>;

const outLevel = (volume: number, muted: boolean) => (muted ? 0 : (volume / 100) * 0.35);

export class LiveEngine {
  private graph?: VoiceGraph;
  private out?: Tone.Gain;
  private fft?: Tone.FFT;
  private building?: Promise<boolean>;
  private repeatId?: number;

  get ready() {
    return !!this.graph;
  }

  /** Must be called from a user gesture the first time (browser autoplay policy). */
  ensure(): Promise<boolean> {
    if (this.graph) return Promise.resolve(true);
    this.building ??= (async () => {
      try {
        await Tone.start();
        this.out = new Tone.Gain(0).toDestination();
        this.fft = new Tone.FFT(64);
        this.out.connect(this.fft);
        this.graph = await buildVoice(this.out);
        this.graph.start(Tone.now());
        return true;
      } catch {
        this.building = undefined;
        return false;
      }
    })();
    return this.building;
  }

  setOutput(volume: number, muted: boolean) {
    this.out?.gain.setTargetAtTime(outLevel(volume, muted), Tone.now(), 0.05);
  }

  apply(v: Voice, droneOn: boolean, time = Tone.now()) {
    if (!this.graph) return;
    this.graph.set(v, time);
    this.graph.gate(droneOn, time);
  }

  ring(freq: number, time = Tone.now()) {
    this.graph?.ring(freq, time);
  }

  /** Start the transport; `onStep` fires on the audio clock every `interval` s. */
  play(interval: number, onStep: (time: number) => void) {
    const transport = Tone.getTransport();
    if (this.repeatId !== undefined) transport.clear(this.repeatId);
    this.repeatId = transport.scheduleRepeat(onStep, interval, transport.seconds + interval);
    if (transport.state !== 'started') transport.start();
  }

  stop() {
    const transport = Tone.getTransport();
    if (this.repeatId !== undefined) transport.clear(this.repeatId);
    this.repeatId = undefined;
    transport.stop();
  }

  /** 24 spectrum bands, 0–1. */
  levels(): number[] {
    if (!this.fft) return new Array(24).fill(0);
    const db = this.fft.getValue();
    const out: number[] = [];
    for (let i = 0; i < 24; i++) out.push(Math.max(0, Math.min(1, (db[i + 1] + 100) / 70)));
    return out;
  }

  dispose() {
    this.stop();
    this.graph?.dispose();
    this.fft?.dispose();
    this.out?.dispose();
    this.graph = undefined;
    this.building = undefined;
  }
}

/** Render the full 12-frame sequence offline and return a WAV file. */
export async function renderSequenceWav(voices: Voice[], step: number, volume: number): Promise<Blob> {
  const tail = 3;
  const duration = voices.length * step + tail;
  const buffer = await Tone.Offline(async () => {
    const out = new Tone.Gain(outLevel(volume, false) * 1.6).toDestination();
    const g = await buildVoice(out);
    g.set(voices[0], 0, true);
    g.start(0);
    g.gate(true, 0);
    voices.forEach((v, i) => {
      const t = i * step;
      if (i) g.set(v, t);
      g.ring(v.freq, t + 0.01);
    });
    g.gate(false, voices.length * step);
  }, duration, 2, 44100);
  const audio = buffer.get();
  if (!audio) throw new Error('Offline render produced no audio');
  return encodeWav(audio);
}

function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const bytes = 44 + len * ch * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true);
  view.setUint32(24, buf.sampleRate, true); view.setUint32(28, buf.sampleRate * ch * 2, true);
  view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, len * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
