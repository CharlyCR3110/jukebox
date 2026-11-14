import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as Tone from 'tone';
import { AudioEngine } from './audio/engine';
import { cueFor, describe, fmtDate, fmtLat, fmtLon } from './audio/mapping';
import { MapView } from './components/MapView';
import { Explainer, Header, Readout, SoundPanel, Timeline } from './components/Panels';
import { loadManifest, type Manifest } from './data/manifest';
import { attachKeyboard } from './input/keyboard';
import { connectSerial, serialSupported, type SerialConnection } from './input/serial';
import { frameInterval, initialState, reducer, type Intent } from './state/store';

const PREFS_KEY = 'earth-jukebox:audio';

function savedPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { muted?: boolean; volume?: number };
  } catch {
    return {};
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(savedPrefs()));
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [levels, setLevels] = useState<number[] | null>(null);
  const [explainOpen, setExplainOpen] = useState(true);
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  useEffect(() => {
    loadManifest()
      .then((m) => {
        setManifest(m);
        dispatch({ type: 'INIT', frameCount: m.frames.length, locationIds: m.locations.map((l) => l.id) });
        m.frames.forEach((f) => { const i = new Image(); i.src = `${import.meta.env.BASE_URL}${f.imageUrl}`; });
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ muted: state.muted, volume: state.volume }));
  }, [state.muted, state.volume]);

  // ---- derived observation -----------------------------------------------------
  const frame = manifest?.frames[state.frameIndex];
  const location = manifest?.locations.find((l) => l.id === state.locationId);
  const point = frame && location ? frame.points[location.id] : undefined;
  const cue = useMemo(() => cueFor(point, manifest?.dataMode ?? 'measured_sst'), [point, manifest]);

  // ---- audio -------------------------------------------------------------------
  const engine = useRef<AudioEngine | null>(null);
  engine.current ??= new AudioEngine();
  if (import.meta.env.DEV) (window as unknown as { __ej?: unknown }).__ej = { engine: engine.current, Tone }; // dev-only test hook
  const live = useRef({ state, manifest });
  live.current = { state, manifest };
  const played = useRef<{ frame: number; loc: string; speed: number } | null>(null);

  /** Intents from every input. PLAY needs a user gesture to unlock audio; keyboard and clicks are gestures. */
  const act = useCallback((i: Intent) => {
    if (i.type === 'PLAY' || (i.type === 'TOGGLE_PLAY' && !live.current.state.playing)) {
      engine.current!.ensure().then((ok) => setAudioBlocked(!ok));
    }
    dispatch(i);
  }, []);

  useEffect(() => () => engine.current?.dispose(), []);
  useEffect(() => engine.current?.setOutput(state.volume, state.muted), [state.volume, state.muted, audioBlocked]);

  useEffect(() => {
    const e = engine.current!;
    if (!state.playing || !manifest) {
      e.stop();
      played.current = null;
      setLevels(null);
      return;
    }
    const p = played.current;
    if (p && p.frame === state.frameIndex && p.loc === state.locationId && p.speed === state.speed) return;
    const start = async () => {
      if (!(await e.ensure())) { setAudioBlocked(true); return; }
      e.setOutput(state.volume, state.muted);
      played.current = { frame: state.frameIndex, loc: state.locationId, speed: state.speed };
      e.play(cue, frameInterval(state.speed), (time) => {
        const { state: s, manifest: m } = live.current;
        const next = (played.current!.frame + 1) % m!.frames.length;
        played.current = { ...played.current!, frame: next };
        Tone.getDraw().schedule(() => dispatch({ type: 'SET_FRAME', index: next }), time);
        return cueFor(m!.frames[next].points[s.locationId], m!.dataMode);
      });
    };
    void start();
  }, [state.playing, state.frameIndex, state.locationId, state.speed, manifest, cue, state.volume, state.muted]);

  useEffect(() => {
    if (!state.playing || audioBlocked) return;
    let raf = 0, last = 0;
    const tick = (t: number) => {
      if (t - last > (reduced ? 300 : 90)) { last = t; setLevels(engine.current!.levels()); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.playing, audioBlocked, reduced]);

  // ---- inputs ------------------------------------------------------------------
  useEffect(() => attachKeyboard(act, () => live.current.state.muted), [act]);

  const serial = useRef<SerialConnection | null>(null);
  const toggleController = async () => {
    if (serial.current) { await serial.current.close(); serial.current = null; return; }
    void engine.current!.ensure().then((ok) => setAudioBlocked(!ok)); // the click unlocks audio for controller PLAY
    serial.current = await connectSerial(act, (connected, msg) => {
      dispatch({ type: 'CONTROLLER', connected });
      if (!connected) serial.current = null;
      setNotice(msg ?? '');
    });
  };

  // ---- render ------------------------------------------------------------------
  const soundOn = state.playing && !state.muted && !audioBlocked;
  const soundText = audioBlocked ? 'NO AUDIO' : state.muted ? 'MUTED' : soundOn ? 'SOUND ON' : engine.current.ready ? 'SOUND READY' : 'SOUND OFF · PRESS PLAY';
  const header = (
    <Header
      manifest={manifest}
      soundText={soundText}
      soundOn={soundOn}
      controller={{ supported: serialSupported(), connected: state.controllerConnected, onToggle: toggleController }}
    />
  );

  if (!manifest || !frame || !location) {
    return (
      <div className="app">
        {header}
        <main className="main"><p role="status" className="load">{loadError || 'Loading observations…'}</p></main>
      </div>
    );
  }

  const measured = manifest.dataMode === 'measured_sst';
  const description = describe({
    mode: manifest.dataMode, date: frame.date, frameNumber: state.frameIndex + 1, frameCount: manifest.frames.length,
    locationName: location.name, p: point, days: frame.daysSincePrevious, cue,
  });
  const series = manifest.frames.map((f) => {
    const p = f.points[location.id];
    return !p?.isValid ? null : measured ? p.sstC : p.feature ?? null;
  });
  const scale = manifest.colorScale;
  const gradient = scale ? `linear-gradient(90deg, ${scale.stops.join(', ')})` : undefined;

  return (
    <div className="app">
      {header}
      {!measured && (
        <div className="mode-banner mono" role="note">
          VISUAL FEATURE MODE · Sound follows the colours of the NASA visualization (red–blue index). These are not temperature measurements.
          Run <code>scripts/prepare_data.py --mode measured</code> with Earthdata Login to load measured MUR SST.
        </div>
      )}
      <main className="main">
        <section aria-label="Visualization and timeline" className="viz">
          <MapView
            frames={manifest.frames}
            frameIndex={state.frameIndex}
            locations={manifest.locations}
            locationId={state.locationId}
            label={`${manifest.title}, ${fmtDate(frame.date)}. Selected location ${location.name}, ${fmtLat(location.lat)} ${fmtLon(location.lon)}. Use the location list to change it.`}
            onSelect={(id) => { setNotice(''); act({ type: 'SELECT_LOCATION', id }); }}
            onMiss={() => setNotice('No prepared location near that point. Select one of the ringed markers.')}
          >
            <div className="card">
              <span className="eyebrow mono">OCEAN / CLIMATE</span>
              <h1>{manifest.title}</h1>
              <span className="mono fg small">OBS {String(state.frameIndex + 1).padStart(2, '0')}/{manifest.frames.length} · {frame.date} · {location.name.toUpperCase()}</span>
            </div>
            <div className={`badge mono${measured ? '' : ' warn-badge'}`}>
              {measured ? `NASA SVS ${manifest.visualization.svsId} · FRAME ${frame.date}` : 'VISUAL FEATURE · NOT MEASURED SST'}
            </div>
          </MapView>

          <div className="legend-row">
            <div className="legend">
              <span className="eyebrow mono">SST °C</span>
              <div className="legend-scale">
                <div role="img" aria-label="Color scale of the NASA frame: dark blue at minus 5 degrees Celsius, white near 15, dark red at 35" className="ramp" style={{ background: gradient }} />
                <div aria-hidden="true" className="ramp-ticks mono"><span>−5</span><span>5</span><span>15</span><span>25</span><span>35</span></div>
              </div>
              <span className="land-key"><span aria-hidden="true" className="land-sw" />Land</span>
            </div>
            <p className="source">
              Frames: <a href={frame.sourceUrl} target="_blank" rel="noreferrer">NASA SVS {manifest.visualization.svsId} frame for {frame.date}</a>, reprojected to Web Mercator. Colour scale from the SVS colorbar.
            </p>
          </div>

          <Readout manifest={manifest} frame={frame} location={location} point={point} />

          <Timeline
            frames={manifest.frames}
            frameIndex={state.frameIndex}
            playing={state.playing}
            speed={state.speed}
            series={series}
            onPrev={() => act({ type: 'PREV_FRAME' })}
            onNext={() => act({ type: 'NEXT_FRAME' })}
            onToggle={() => act({ type: 'TOGGLE_PLAY' })}
            onSpeed={(speed) => act({ type: 'SET_SPEED', speed })}
            onScrub={(index) => act({ type: 'SET_FRAME', index })}
          />

          <div className="words">
            <span className="eyebrow mono">IN WORDS</span>
            <p aria-live={state.playing ? 'off' : 'polite'}>{description}</p>
          </div>
          <p role="status" className="notice">{notice}</p>
        </section>

        <div className="side">
          <SoundPanel
            manifest={manifest}
            locations={manifest.locations}
            locationId={state.locationId}
            point={point}
            cue={cue}
            playing={state.playing}
            muted={state.muted}
            volume={state.volume}
            levels={levels}
            audioBlocked={audioBlocked}
            onLocation={(id) => act({ type: 'SELECT_LOCATION', id })}
            onToggle={() => act({ type: 'TOGGLE_PLAY' })}
            onVolume={(value) => act({ type: 'SET_VOLUME', value })}
            onMute={() => act({ type: state.muted ? 'UNMUTE' : 'MUTE' })}
          />
          <Explainer manifest={manifest} cue={cue} description={description} open={explainOpen} onToggle={() => setExplainOpen((o) => !o)} />
        </div>
      </main>
      <footer id="about" className="ftr">
        <span>Earth Jukebox · NASA Space Apps Challenge 2026 prototype</span>
        <span>Keyboard: Space play/pause · ←/→ date · ↑/↓ location · M mute · Tab through all controls</span>
      </footer>
    </div>
  );
}
