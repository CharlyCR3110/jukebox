import type { FrameObservation, Location, Manifest, PointObservation } from '../data/manifest';
import {
  DELTA_MAX_C, FEATURE_DELTA_MAX, PITCH, PULSES, UNCHANGED_C, directionSound, fmtDate, fmtLat, fmtLon, signed,
  type SoundCue,
} from '../audio/mapping';
import type { Speed } from '../state/store';
import { voiceFor, type VoiceDef } from '../audio/voices';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).toUpperCase();

export function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="chev">
      <path d="M1 3l4 4 4-4" stroke="#929B96" fill="none" strokeWidth="1.5" />
    </svg>
  );
}

export function Header(p: {
  manifest: Manifest | null;
  soundText: string;
  soundOn: boolean;
  controller: { supported: boolean; connected: boolean; onToggle: () => void };
}) {
  const m = p.manifest;
  return (
    <header className="hdr">
      <a href="#" aria-label="Earth Jukebox home" className="brand">
        <span className="brand-a">EARTH</span><span className="brand-slash mono">/</span><span className="brand-b mono">JUKEBOX</span>
      </a>
      <span className="hdr-src mono">
        {m ? <>{m.dataMode === 'measured_sst' ? 'MUR SST v4.1 · ' : ''}<a href={m.visualization.url} target="_blank" rel="noreferrer">NASA SVS {m.visualization.svsId}</a>{m.visualization.eicKeyword ? ' · EIC' : ''}{m.dataMode === 'visual_feature' ? ' · VISUAL FEATURE MODE' : ''}</> : 'LOADING DATA'}
      </span>
      <div className="hdr-right mono">
        <span role="status" className="snd">
          <span aria-hidden="true" className="dot" style={{ background: p.soundOn ? '#B8E36A' : '#929B96' }} />
          {p.soundText}
        </span>
        {p.controller.supported ? (
          <button type="button" className="chip" onClick={p.controller.onToggle} aria-pressed={p.controller.connected}>
            CONTROLLER · {p.controller.connected ? 'CONNECTED' : 'CONNECT'}
          </button>
        ) : (
          <span title="Web Serial needs desktop Chrome or Edge">CONTROLLER · NOT SUPPORTED</span>
        )}
      </div>
    </header>
  );
}

export function Readout(p: { manifest: Manifest; frame: FrameObservation; location: Location; point: PointObservation | undefined }) {
  const { point: o, manifest: m } = p;
  const measured = m.dataMode === 'measured_sst';
  const days = p.frame.daysSincePrevious;
  return (
    <section aria-label="Observation" className="readout">
      <div className="ro-cell">
        <span className="eyebrow mono">LOCATION</span>
        <span className="ro-main">{p.location.name}</span>
        <span className="mono muted small">{fmtLat(p.location.lat)} {fmtLon(p.location.lon)}</span>
      </div>
      <div className="ro-cell">
        <span className="eyebrow mono">{measured ? 'SEA-SURFACE TEMP.' : 'FRAME RED–BLUE INDEX'}</span>
        <span className="ro-big mono">
          {!o?.isValid ? '—' : measured ? `${o.sstC!.toFixed(2)} °C` : signed(o.feature ?? 0, 3)}
        </span>
        <span className="mono muted small">{fmtDate(p.frame.date)}</span>
      </div>
      <div className="ro-cell">
        <span className="eyebrow mono">CHANGE SINCE PREVIOUS OBS.</span>
        <span className="ro-big mono">
          {measured
            ? (o?.deltaC == null ? '—' : `${signed(o.deltaC, 2)} °C`)
            : (o?.featureDelta == null ? '—' : signed(o.featureDelta, 3))}
        </span>
        <span className="mono muted small">{days ? `over ${days} days` : 'first observation'}</span>
      </div>
      <div className="ro-cell">
        <span className="eyebrow mono">DATA VALIDITY</span>
        <span className={`ro-main mono ${o?.isValid ? 'accent' : 'warn'}`}>{o?.isValid ? '✓ VALID' : '✕ NO VALID DATA'}</span>
        <span className="mono muted small">{o?.coverage != null ? `${Math.round(o.coverage * 100)}% box coverage` : ''}</span>
      </div>
    </section>
  );
}

export function Timeline(p: {
  frames: FrameObservation[];
  frameIndex: number;
  playing: boolean;
  speed: Speed;
  series: (number | null)[];
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
  onSpeed: (s: Speed) => void;
  onScrub: (i: number) => void;
}) {
  const n = p.frames.length;
  const F = p.frames[p.frameIndex];
  const vals = p.series.filter((v): v is number => v !== null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 1200 : 600);
  let d = '';
  p.series.forEach((v, i) => {
    if (v === null) return;
    d += `${d && p.series[i - 1] !== null ? 'L' : 'M'}${x(i).toFixed(1)} ${(56 - ((v - lo) / span) * 48).toFixed(1)} `;
  });

  return (
    <div className="timeline">
      <div className="tl-row">
        <div role="group" aria-label="Transport" className="transport">
          <button type="button" className="tbtn" onClick={p.onPrev} aria-label="Previous observation">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#E8E9E2" strokeWidth="1.5" aria-hidden="true"><path d="M3 2v10M11 2 5 7l6 5" /></svg>
          </button>
          <button type="button" className="tbtn play" onClick={p.onToggle} aria-label={p.playing ? 'Pause' : 'Play'}>
            {p.playing
              ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2" width="3" height="10" fill="#101311" /><rect x="8" y="2" width="3" height="10" fill="#101311" /></svg>
              : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2v10l8-5z" fill="#101311" /></svg>}
          </button>
          <button type="button" className="tbtn" onClick={p.onNext} aria-label="Next observation">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#E8E9E2" strokeWidth="1.5" aria-hidden="true"><path d="M11 2v10M3 2l6 5-6 5" /></svg>
          </button>
        </div>
        <div className="mono frame-count">
          <span className="big">{String(p.frameIndex + 1).padStart(2, '0')}<span className="muted"> / {n}</span></span>
          <span className="small fg">{fmtDate(F.date)}</span>
          <span className="small muted">{(1 / p.speed).toFixed(1)} s per observation</span>
        </div>
        <div className="speed">
          <span id="speed-label" className="eyebrow mono">SPEED</span>
          <div role="group" aria-labelledby="speed-label" className="seg">
            {([1, 2] as Speed[]).map((v) => (
              <button key={v} type="button" aria-pressed={p.speed === v} className={`seg-btn mono${p.speed === v ? ' on' : ''}`} onClick={() => p.onSpeed(v)}>{v}×</button>
            ))}
          </div>
        </div>
      </div>
      <div className="trace-wrap">
        <div className="trace">
          <svg viewBox="0 0 1200 64" preserveAspectRatio="none" aria-hidden="true">
            <path d={d} stroke="#B8E36A" strokeWidth="2" vectorEffect="non-scaling-stroke" fill="none" strokeLinejoin="round" />
            {p.series.map((v, i) => (v === null ? <path key={i} d={`M${x(i)} 8V56`} stroke="#E36A6A" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" /> : null))}
          </svg>
          <input
            className="scrub" type="range" min={0} max={n - 1} step={1} value={p.frameIndex}
            onChange={(e) => p.onScrub(+e.target.value)}
            aria-label="Timeline: choose observation"
            aria-valuetext={`Observation ${p.frameIndex + 1} of ${n}, ${fmtDate(F.date)}`}
          />
        </div>
        <div aria-hidden="true" className="months mono">
          {p.frames.map((f, i) => (
            <span key={f.frameId} className={i === 0 || i === n - 1 || i === p.frameIndex ? 'keep' : undefined} style={{ left: pct(n > 1 ? i / (n - 1) : 0.5), color: i === p.frameIndex ? '#E8E9E2' : '#929B96', transform: `translateX(${i === 0 ? '0' : i === n - 1 ? '-100%' : '-50%'})` }}>{shortDate(f.date)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SoundPanel(p: {
  manifest: Manifest;
  locations: Location[];
  locationId: string;
  point: PointObservation | undefined;
  cue: SoundCue;
  voice: VoiceDef;
  zoneVoices: boolean;
  onZoneVoices: (on: boolean) => void;
  playing: boolean;
  muted: boolean;
  volume: number;
  levels: number[] | null;
  audioBlocked: boolean;
  onLocation: (id: string) => void;
  onToggle: () => void;
  onVolume: (v: number) => void;
  onMute: () => void;
}) {
  const measured = p.manifest.dataMode === 'measured_sst';
  const c = p.cue;
  const input = !p.point?.isValid ? 'no valid data' : measured ? `SST ${p.point.sstC!.toFixed(2)} °C` : `index ${signed(p.point.feature ?? 0, 3)}`;
  const delta = measured ? p.point?.deltaC : p.point?.featureDelta;
  const deltaText = delta == null ? 'change unavailable' : measured ? `Δ ${signed(delta, 2)} °C` : `Δ ${signed(delta, 3)}`;
  const pitchPos = c.frequencyHz === null ? 0 : (c.frequencyHz - PITCH.baseHz) / PITCH.spanHz;

  return (
    <aside aria-labelledby="sonif-title" className="panel">
      <div>
        <h2 id="sonif-title" className="panel-title mono">SONIFICATION</h2>
        <p className="panel-sub">{measured ? 'Hear measured ocean temperature change.' : 'Hear the visualization’s colour change (not a temperature).'}</p>
      </div>

      <div className="field">
        <label htmlFor="loc" className="eyebrow mono">LISTENING LOCATION</label>
        <div className="select-wrap">
          <select id="loc" className="ej" value={p.locationId} onChange={(e) => p.onLocation(e.target.value)}>
            {p.locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {fmtLat(l.lat)} {fmtLon(l.lon)}</option>)}
          </select>
          <Chevron />
        </div>
        <span className="note">Or select a marker on the map. Keyboard: ↑/↓ change location, ←/→ change date, Space plays.</span>
      </div>

      <div className="player">
        <button type="button" className={`play-big mono${p.playing ? ' on' : ''}`} onClick={p.onToggle} aria-label={p.playing ? 'Pause' : 'Play'}>
          {p.playing ? 'PAUSE' : 'PLAY'}
        </button>
        <div className="meter-row">
          <div aria-hidden="true" className="meter">
            {Array.from({ length: 24 }, (_, i) => {
              const v = p.levels ? p.levels[i] : 0;
              return <div key={i} style={{ height: `${Math.max(2, Math.round(v * 28))}px`, background: v > 0.02 ? '#B8E36A' : '#3A413D' }} />;
            })}
          </div>
          <span className="mono state" style={{ color: p.playing && !p.muted ? '#B8E36A' : '#929B96' }}>
            {p.audioBlocked ? 'AUDIO UNAVAILABLE · TEXT ONLY' : p.playing ? (p.muted ? '● PLAYING · MUTED' : c.frequencyHz === null ? '● PLAYING · SILENT (NO DATA)' : '● PLAYING') : '■ PAUSED'}
          </span>
        </div>
      </div>

      <div role="group" aria-label="Current mapping" className="param">
        <div className="param-head">
          <span className="mono param-name"><span className="muted">01</span> PITCH</span>
          <span className="mono param-out">{c.frequencyHz === null ? 'silent' : `${Math.round(c.frequencyHz)} Hz`}</span>
        </div>
        <div className="param-src"><span>{measured ? 'Temperature' : 'Red–blue index'}</span><span className="mono fg">{input}{c.pitchClamped ? ' · CLAMPED' : ''}</span></div>
        <div aria-hidden="true" className="bar">
          <div className="bar-fill" style={{ left: 0, width: pct(pitchPos) }} />
          <div className="bar-mark" style={{ left: pct(pitchPos) }} />
        </div>
        <div className="param-src mono small"><span>{measured ? `${PITCH.minC} °C → ${PITCH.baseHz} Hz` : '−1 → 220 Hz'}</span><span>{measured ? `${PITCH.maxC} °C → ${PITCH.baseHz + PITCH.spanHz} Hz` : '+1 → 880 Hz'}</span></div>
      </div>

      <div role="group" aria-label="Change cue" className="param">
        <div className="param-head">
          <span className="mono param-name"><span className="muted">02</span> CHANGE</span>
          <span className="mono param-out">{c.frequencyHz === null ? '—' : `${c.direction === 'unavailable' ? 'no glide' : c.direction === 'unchanged' ? 'steady' : c.direction === 'rising' ? '↗ glide up' : '↘ glide down'} · ${c.pulses}×`}</span>
        </div>
        <div className="param-src"><span>Direction and size of change</span><span className="mono fg">{deltaText}{c.pulsesCapped ? ' · CAPPED' : ''}</span></div>
        <div aria-hidden="true" className="pulses">
          {Array.from({ length: PULSES.max }, (_, i) => <span key={i} className={i < c.pulses ? 'on' : ''} />)}
        </div>
        <div className="param-src mono small">
          <span>{measured ? `0 °C → 1 pulse` : '0 → 1 pulse'}</span>
          <span>{measured ? `≥ ${DELTA_MAX_C} °C → 5 pulses` : `≥ ${FEATURE_DELTA_MAX} → 5 pulses`}</span>
        </div>
      </div>

      <div role="group" aria-label="Zone instrument" className="param">
        <div className="param-head">
          <span className="mono param-name"><span className="muted">03</span> VOICE</span>
          <span className="mono param-out">{p.voice.name}</span>
        </div>
        <div className="param-src"><span>{p.zoneVoices ? 'Zone identity (design choice, not data)' : 'Same tone for every location'}</span></div>
        <p className="voice-why">{p.voice.why}</p>
        <label className="toggle">
          <input type="checkbox" checked={p.zoneVoices} onChange={(e) => p.onZoneVoices(e.target.checked)} />
          <span>Zone instruments</span>
        </label>
      </div>

      <div className="ctl vol">
        <label htmlFor="vol">Volume</label>
        <input className="ej" id="vol" type="range" min={0} max={100} step={1} value={Math.round(p.volume * 100)} onChange={(e) => p.onVolume(+e.target.value / 100)} aria-valuetext={`${Math.round(p.volume * 100)} percent`} />
        <button type="button" className={`mute mono${p.muted ? ' on' : ''}`} onClick={p.onMute} aria-pressed={p.muted}>{p.muted ? 'MUTED' : 'MUTE'}</button>
      </div>
    </aside>
  );
}

export function Explainer(p: { manifest: Manifest; locations: Location[]; zoneVoices: boolean; cue: SoundCue; description: string; open: boolean; onToggle: () => void }) {
  const m = p.manifest;
  const measured = m.dataMode === 'measured_sst';
  return (
    <section id="interpretation" aria-labelledby="hear-btn" className="explain">
      <h2>
        <button id="hear-btn" type="button" className="mono" onClick={p.onToggle} aria-expanded={p.open} aria-controls="hear-body">
          <span>WHAT AM I HEARING?</span>
          <span aria-hidden="true" className="accent icon">{p.open ? '−' : '+'}</span>
        </button>
      </h2>
      {p.open && (
        <div id="hear-body" className="explain-body">
          <dl>
            <dt className="eyebrow mono">DATA</dt><dd aria-hidden="true" /><dd className="eyebrow mono">SOUND</dd>
            {measured ? (
              <>
                <dt>Sea-surface temperature</dt><dd aria-hidden="true" className="accent">→</dd>
                <dd>Pitch: warmer water, higher tone. <span className="mono small">Hz = 220 + clamp(°C, 0, 35) / 35 × 660</span></dd>
              </>
            ) : (
              <>
                <dt>Red–blue index of frame pixels</dt><dd aria-hidden="true" className="accent">→</dd>
                <dd>Pitch: redder pixels, higher tone. <span className="mono small">Hz = 220 + (index + 1) / 2 × 660</span></dd>
              </>
            )}
            <dt>Direction of change</dt><dd aria-hidden="true" className="accent">→</dd>
            <dd>Rising: upward glide. Falling: downward glide. Change under {measured ? `${UNCHANGED_C} °C` : '0.005'}: steady onset. No previous value: no glide.</dd>
            <dt>Size of change</dt><dd aria-hidden="true" className="accent">→</dd>
            <dd>1–5 pulses per observation. Pulses describe the change between the shown observations, not a change per second.</dd>
            <dt>Missing or land data</dt><dd aria-hidden="true" className="accent">→</dd><dd>Silence and a “no valid data” notice. Never a zero.</dd>
            <dt>Location (identity only)</dt><dd aria-hidden="true" className="accent">→</dd>
            <dd>
              {p.zoneVoices ? 'Each zone has its own instrument so you can tell places apart by ear. Tone colour only: pitch, glide and pulses follow the same rules everywhere.' : 'Zone instruments are off: every location uses the same tone.'}
              {p.zoneVoices && (
                <ul className="voice-list">
                  {p.locations.map((l) => <li key={l.id}><span className="fg">{l.name}</span>: {voiceFor(l.id, true).name}</li>)}
                </ul>
              )}
            </dd>
          </dl>
          <p className="fine">Now: {p.cue.frequencyHz === null ? p.cue.silentReason : `${Math.round(p.cue.frequencyHz)} Hz, ${directionSound(p.cue.direction)}, ${p.cue.pulses} pulse${p.cue.pulses > 1 ? 's' : ''}.`} {p.description}</p>
          <p className="fine">
            <strong>Sampling:</strong> {m.samplingMethod}
          </p>
          <p className="fine">
            <strong>Sources:</strong> Visual frames by {m.visualization.credit}, <a href={m.visualization.url} target="_blank" rel="noreferrer">“{m.visualization.title}” (SVS {m.visualization.svsId})</a>.{' '}
            {m.numericSource ? <>Values from <a href={m.numericSource.url} target="_blank" rel="noreferrer">{m.numericSource.name}</a>, {m.numericSource.credit} (<a href={m.numericSource.doi} target="_blank" rel="noreferrer">DOI</a>).</> : 'No measured values are loaded in this mode.'}{' '}
            Generated {m.generatedAt.slice(0, 10)} by {m.generator}. The mappings are design choices, not properties of the data.
          </p>
        </div>
      )}
    </section>
  );
}
