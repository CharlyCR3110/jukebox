import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as Tone from 'tone';
import { DatasetBar, Footer, Header } from './components/Chrome';
import { MapView } from './components/MapView';
import { SonificationPanel } from './components/SonificationPanel';
import { Timeline } from './components/Timeline';
import { colormapGradient } from './data/colormap';
import { DATASETS, DEFAULT_YEAR, OCEAN, POINTS } from './data/datasets';
import { useFrames } from './data/useFrames';
import { LiveEngine, renderSequenceWav } from './sonify/engine';
import {
  clamp, describe, fmtLat, fmtLon, globalSequence, noteName, probeSequence, readingFor, voicesFor,
  type Probe, type Settings, type Voice,
} from './sonify/mapping';

type AudioState = 'idle' | 'on' | 'blocked';
const DEFAULT_PROBE: [number, number] = [0, -150];
const half = (v: number) => Math.round(v * 2) / 2;

export default function App() {
  const dataset = OCEAN;
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [nonce, setNonce] = useState(0);
  const frames = useFrames(dataset, year, nonce);
  const set = frames.set;

  const [frame, setFrame] = useState(6);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(70);
  const [settings, setSettings] = useState<Settings>({ span: 2, sens: 50, depth: 50 });
  const [explainOpen, setExplainOpen] = useState(true);
  const [point, setPoint] = useState('global');
  const [probe, setProbe] = useState<Probe>(null);
  const [audio, setAudio] = useState<AudioState>('idle');
  const [levels, setLevels] = useState<number[] | null>(null);
  const [datasetNotice, setDatasetNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  // ---- data → sound ---------------------------------------------------------
  const global = useMemo(() => (set ? globalSequence(set.frames) : null), [set]);
  const probeSeq = useMemo(() => (set && probe ? probeSequence(set.frames, probe) : null), [set, probe]);
  const reading = useMemo(
    () => (global ? readingFor(global, probeSeq, frame, settings) : null),
    [global, probeSeq, frame, settings],
  );
  const voices = useMemo(() => (global ? voicesFor(global, probeSeq, settings) : []), [global, probeSeq, settings]);

  // ---- audio engine ---------------------------------------------------------
  const engine = useRef<LiveEngine | null>(null);
  engine.current ??= new LiveEngine();
  const frameRef = useRef(frame);
  const voicesRef = useRef<Voice[]>(voices);
  const playingRef = useRef(playing);
  const blip = useRef<number | null>(null);
  const fallbackTimer = useRef<number | null>(null);
  frameRef.current = frame;
  voicesRef.current = voices;
  playingRef.current = playing;

  useEffect(() => () => engine.current?.dispose(), []);
  useEffect(() => engine.current?.setOutput(volume, muted), [volume, muted, audio]);
  useEffect(() => {
    if (reading) engine.current?.apply(reading, playing || blip.current !== null);
  }, [reading, playing]);

  // The transport runs on the audio clock; each tick advances one frame, strikes the
  // bell for the new month, then syncs the UI via Tone.Draw.
  const step = useCallback((time: number) => {
    const next = (frameRef.current + 1) % 12;
    frameRef.current = next;
    const v = voicesRef.current[next];
    if (v) {
      engine.current?.apply(v, true, time);
      engine.current?.ring(v.freq, time);
    }
    Tone.getDraw().schedule(() => setFrame(next), time);
  }, []);

  const startClock = useCallback((spd: number) => {
    if (fallbackTimer.current) clearInterval(fallbackTimer.current);
    fallbackTimer.current = null;
    if (engine.current?.ready) engine.current.play(1.6 / spd, step);
    else fallbackTimer.current = window.setInterval(() => setFrame((f) => (f + 1) % 12), 1600 / spd);
  }, [step]);

  const stopClock = useCallback(() => {
    engine.current?.stop();
    if (fallbackTimer.current) clearInterval(fallbackTimer.current);
    fallbackTimer.current = null;
    setLevels(null);
  }, []);

  const togglePlay = useCallback(async () => {
    if (playingRef.current) {
      setPlaying(false);
      stopClock();
      return;
    }
    const ok = await engine.current!.ensure();
    setAudio(ok ? 'on' : 'blocked');
    if (ok) engine.current!.setOutput(volume, muted);
    setPlaying(true);
    startClock(speed);
  }, [muted, speed, startClock, stopClock, volume]);

  useEffect(() => {
    if (!playing || audio !== 'on') return;
    let raf = 0, last = 0;
    const tick = (t: number) => {
      if (t - last > (reduced ? 300 : 90)) {
        last = t;
        setLevels(engine.current!.levels());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, audio, reduced]);

  const previewBlip = (f: number) => {
    const v = voicesRef.current[f];
    if (playingRef.current || muted || !engine.current?.ready || !v) return;
    if (blip.current) clearTimeout(blip.current);
    engine.current.apply(v, true);
    engine.current.ring(v.freq);
    blip.current = window.setTimeout(() => {
      blip.current = null;
      if (!playingRef.current) engine.current?.apply(voicesRef.current[frameRef.current] ?? v, false);
    }, 450);
  };

  const goto = (f: number) => {
    setFrame(f);
    frameRef.current = f;
    previewBlip(f);
  };

  const onSpeed = (v: number) => {
    setSpeed(v);
    if (playingRef.current) startClock(v);
  };

  const onExport = async () => {
    if (!voices.length) return;
    if (playingRef.current) { setPlaying(false); stopClock(); }
    setExporting(true);
    try {
      const blob = await renderSequenceWav(voices, 1.6 / speed, volume);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const where = probe ? `${fmtLat(probe[0])}-${fmtLon(probe[1])}`.replace(/[°\s]/g, '') : 'global';
      a.href = url;
      a.download = `earth-jukebox_${dataset.id}_${year}_${where}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setDatasetNotice(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  // ---- probe / listening point ----------------------------------------------
  const placeProbe = (lat: number, lon: number) => {
    setProbe([clamp(half(lat), -85, 85), half(lon)]);
    setPoint('custom');
  };

  const onMapKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k === 'Escape') { setProbe(null); setPoint('global'); return; }
    if ((k === 'Enter' || k === ' ') && !probe) { e.preventDefault(); placeProbe(...DEFAULT_PROBE); return; }
    const d = e.shiftKey ? 1 : 5;
    const moves: Record<string, [number, number]> = { ArrowUp: [d, 0], ArrowDown: [-d, 0], ArrowLeft: [0, -d], ArrowRight: [0, d] };
    if (!moves[k]) return;
    e.preventDefault();
    const p = probe ?? DEFAULT_PROBE;
    let lon = p[1] + moves[k][1];
    if (lon >= 180) lon -= 360;
    if (lon < -180) lon += 360;
    placeProbe(p[0] + moves[k][0], lon);
  };

  const onPoint = (v: string) => {
    setPoint(v);
    if (v === 'global') setProbe(null);
    else if (v === 'custom') setProbe((p) => p ?? DEFAULT_PROBE);
    else setProbe([...POINTS[v].at]);
  };

  // ---- labels ----------------------------------------------------------------
  const F = set?.frames[frame];
  const probeName = probe ? `${fmtLat(probe[0])} ${fmtLon(probe[1])}` : '';
  const audioOn = playing && !muted && audio === 'on';
  const soundText = audio === 'blocked' ? 'NO AUDIO' : muted ? 'MUTED' : audioOn ? 'SOUND ON' : 'SOUND READY';
  const soundDot = muted || audio === 'blocked' ? '#929B96' : audioOn ? '#B8E36A' : '#E8E9E2';
  const stateText =
    audio === 'blocked' ? 'AUDIO UNAVAILABLE · TEXT ONLY'
      : playing ? (muted ? '● PLAYING · MUTED' : `● PLAYING · ${reading ? noteName(reading.freq) : ''}`)
      : `■ STOPPED · FRAME ${frame + 1}`;

  const pointNote =
    frames.status === 'loading' ? `Decoding NASA frames ${frames.progress}/12…`
      : frames.status === 'error' ? 'NASA frames unavailable, so there is nothing to listen to yet.'
      : reading?.land ? 'That point is on land or ice. No ocean value, so sound follows the global mean.'
      : probe && reading ? `Sound follows ${probeName}, ${reading.value.toFixed(1)} °C this frame.`
      : 'Sound follows the global ocean mean. Select a point on the map to listen there.';

  const probeTag = reading?.land ? `${probeName} · LAND` : reading?.mode === 'probe' ? `${probeName} · ${reading.value.toFixed(1)} °C` : probeName;
  const monthLong = F ? `${F.long} ${F.date.slice(0, 4)}` : '—';
  const modeLabel = probe && !reading?.land ? `PROBE ${probeName}` : 'GLOBAL MEAN';
  const mapLabel = `Ocean surface temperature map, ${monthLong.toLowerCase()} frame. Select to place the listening probe. Arrow keys move it, Escape returns to the global mean.`;
  const gradient = set ? colormapGradient(set.colormap) : undefined;

  return (
    <div className="app">
      <Header soundText={soundText} soundDot={soundDot} muted={muted} onToggleMute={() => setMuted((m) => !m)} />
      <DatasetBar
        datasets={DATASETS}
        year={year}
        minYear={dataset.minYear!}
        maxYear={dataset.maxYear!}
        notice={datasetNotice}
        onPick={(d) => setDatasetNotice(d.ready ? '' : `${d.name} is not sonified yet. Only Ocean Temperature is available in this prototype.`)}
        onYear={(y) => { setYear(y); if (playingRef.current) { setPlaying(false); stopClock(); } }}
      />

      <main className="main">
        <section aria-label="Visualization and timeline" className="viz">
          <MapView
            frames={set?.frames ?? null}
            frame={frame}
            maxZoom={dataset.maxZoom!}
            probe={probe}
            probeTag={probeTag}
            label={mapLabel}
            onProbe={placeProbe}
            onKeyDown={onMapKey}
          >
            <div className="card">
              <span className="eyebrow mono">{dataset.category}</span>
              <h1>{dataset.title}</h1>
              <span className="mono fg small">FRAME {String(frame + 1).padStart(2, '0')}/12 · {monthLong} · {modeLabel}</span>
            </div>
            <div className="badge mono">
              {F ? `NASA GIBS · MUR SST · ${F.date}${set?.source === 'cache' ? ' · CACHED' : ''}` : 'LOADING NASA IMAGERY'}
            </div>
            {frames.status !== 'ready' && (
              <div className="map-status" role="status">
                {frames.status === 'loading' ? (
                  <span className="mono">DECODING NASA FRAMES · {frames.progress}/12</span>
                ) : (
                  <>
                    <span className="mono">COULD NOT LOAD NASA FRAMES</span>
                    <span className="note">{frames.error}</span>
                    <button type="button" className="chip" onClick={() => setNonce((n) => n + 1)}>RETRY</button>
                  </>
                )}
              </div>
            )}
          </MapView>

          <div className="legend-row">
            <div className="legend">
              <span className="eyebrow mono">{dataset.shortUnits}</span>
              <div className="legend-scale">
                <div role="img" aria-label="Color scale from dark purple at 0 degrees Celsius through blue, green, yellow and orange to dark red at 32 degrees Celsius" className="ramp" style={{ background: gradient }} />
                <div aria-hidden="true" className="ramp-ticks mono"><span>0</span><span>8</span><span>16</span><span>24</span><span>32</span></div>
              </div>
              <span className="land-key"><span aria-hidden="true" className="land-sw" />Land / ice</span>
            </div>
            <p className="source">
              Source: <span className="fg">{dataset.sourceNote}</span> One frame per month (the 15th).
            </p>
          </div>

          {set && reading ? (
            <Timeline
              frames={set.frames}
              frame={frame}
              playing={playing}
              speed={speed}
              series={reading.seq.anoms}
              rates={reading.seq.rates}
              scope={reading.mode === 'probe' ? 'PROBE' : 'GLOBAL'}
              onPrev={() => goto((frame + 11) % 12)}
              onNext={() => goto((frame + 1) % 12)}
              onTogglePlay={togglePlay}
              onSpeed={onSpeed}
              onScrub={goto}
            />
          ) : (
            <div className="timeline placeholder" aria-hidden="true" />
          )}

          <div className="words">
            <span className="eyebrow mono">IN WORDS</span>
            <p aria-live={playing ? 'off' : 'polite'}>
              {set && reading ? describe(reading, set.frames, frame, probe) : pointNote}
            </p>
          </div>
        </section>

        <SonificationPanel
          reading={reading}
          point={point}
          pointNote={pointNote}
          playing={playing}
          muted={muted}
          volume={volume}
          settings={settings}
          levels={levels}
          stateText={stateText}
          explainOpen={explainOpen}
          exporting={exporting}
          canExport={voices.length === 12}
          onPoint={onPoint}
          onTogglePlay={togglePlay}
          onSettings={(s) => setSettings((x) => ({ ...x, ...s }))}
          onVolume={setVolume}
          onToggleMute={() => setMuted((m) => !m)}
          onToggleExplain={() => setExplainOpen((o) => !o)}
          onExport={onExport}
        />
      </main>
      <Footer />
    </div>
  );
}

