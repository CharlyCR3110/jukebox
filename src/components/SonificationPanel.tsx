import { POINTS } from '../data/datasets';
import { noteName, signed, type Reading, type Settings } from '../sonify/mapping';
import { Chevron } from './Chrome';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

interface Props {
  reading: Reading | null;
  point: string;
  pointNote: string;
  playing: boolean;
  muted: boolean;
  volume: number;
  settings: Settings;
  levels: number[] | null;
  stateText: string;
  explainOpen: boolean;
  exporting: boolean;
  canExport: boolean;
  onPoint: (v: string) => void;
  onTogglePlay: () => void;
  onSettings: (s: Partial<Settings>) => void;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onToggleExplain: () => void;
  onExport: () => void;
}

export function SonificationPanel(p: Props) {
  const c = p.reading;
  const s = p.settings;
  const params = c
    ? [
        {
          id: 'p-pitch', num: '01', name: 'PITCH', aria: 'Pitch, from temperature variation', source: 'Temperature variation',
          input: `${signed(c.anom, 2)} °C`, out: `${noteName(c.freq)} · ${Math.round(c.freq)} Hz`,
          fillLeft: pct(Math.min(0.5, 0.5 + c.pn / 2)), fillW: pct(Math.abs(c.pn) / 2), mark: pct(0.5 + c.pn / 2), center: '50%',
          ctlName: 'Span', min: 1, max: 4, val: s.span, ctlText: `±${c.spanOct} oct`,
          set: (v: number) => p.onSettings({ span: v }),
        },
        {
          id: 'p-rhythm', num: '02', name: 'RHYTHM', aria: 'Rhythm, from rate of change', source: 'Rate of change',
          input: `${signed(c.rate, 2)} °C/frame`, out: `${c.pulses.toFixed(1)} pulses/s`,
          fillLeft: '0%', fillW: pct(c.pulses / 8), mark: pct(c.pulses / 8), center: '0%',
          ctlName: 'Sensitivity', min: 0, max: 100, val: s.sens, ctlText: `${s.sens}%`,
          set: (v: number) => p.onSettings({ sens: v }),
        },
        {
          id: 'p-texture', num: '03', name: 'TEXTURE', aria: 'Texture, from spatial variability', source: 'Spatial variability',
          input: `σ ${c.spread.toFixed(2)} °C`, out: `grain ${Math.round(c.grain * 100)}%`,
          fillLeft: '0%', fillW: pct(c.grain), mark: pct(c.grain), center: '0%',
          ctlName: 'Depth', min: 0, max: 100, val: s.depth, ctlText: `${s.depth}%`,
          set: (v: number) => p.onSettings({ depth: v }),
        },
      ]
    : [];

  const explainText =
    c?.mode === 'probe'
      ? 'Higher notes mean this point is warmer than its own 12-frame average; lower notes, cooler. Faster pulses mean the temperature changed more since the previous frame. A rougher, noisier tone means neighbouring water differs more. A soft bell marks each new month.'
      : 'Higher notes represent warmer temperature anomalies across the global ocean. Faster pulses indicate more rapid changes between observations. A rougher, noisier tone means temperatures differ more from place to place. A soft bell marks each new month.';

  return (
    <aside aria-labelledby="sonif-title" className="panel">
      <div>
        <h2 id="sonif-title" className="panel-title mono">SONIFICATION</h2>
        <p className="panel-sub">Translate changing ocean conditions into sound.</p>
      </div>

      <div className="field">
        <label htmlFor="point" className="eyebrow mono">LISTENING POINT</label>
        <div className="select-wrap">
          <select id="point" className="ej" value={p.point} onChange={(e) => p.onPoint(e.target.value)}>
            <option value="global">Global ocean mean</option>
            {Object.entries(POINTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            <option value="custom">Map probe (select a point on the map)</option>
          </select>
          <Chevron />
        </div>
        <span className="note">{p.pointNote}</span>
      </div>

      <div className="player">
        <button
          type="button"
          className={`play-big mono${p.playing ? ' on' : ''}`}
          onClick={p.onTogglePlay}
          aria-label={p.playing ? 'Pause sonification' : 'Play sonification'}
          disabled={!c}
        >
          {p.playing ? 'PAUSE SONIFICATION' : 'PLAY SONIFICATION'}
        </button>
        <div className="meter-row">
          <div aria-hidden="true" className="meter">
            {Array.from({ length: 24 }, (_, i) => {
              const v = p.levels ? p.levels[i] : 0;
              return <div key={i} style={{ height: `${Math.max(2, Math.round(v * 28))}px`, background: v > 0.02 ? '#B8E36A' : '#3A413D' }} />;
            })}
          </div>
          <span role="status" className="mono state" style={{ color: p.playing && !p.muted ? '#B8E36A' : '#929B96' }}>{p.stateText}</span>
        </div>
      </div>

      {params.map((x) => (
        <div key={x.id} role="group" aria-label={x.aria} className="param">
          <div className="param-head">
            <span className="mono param-name"><span className="muted">{x.num}</span> {x.name}</span>
            <span className="mono param-out">{x.out}</span>
          </div>
          <div className="param-src">
            <span>{x.source}</span>
            <span className="mono fg">{x.input}</span>
          </div>
          <div aria-hidden="true" className="bar">
            <div className="bar-fill" style={{ left: x.fillLeft, width: x.fillW }} />
            <div className="bar-mark" style={{ left: x.mark }} />
            <div className="bar-center" style={{ left: x.center }} />
          </div>
          <div className="ctl">
            <label htmlFor={x.id}>{x.ctlName}</label>
            <input className="ej" id={x.id} type="range" min={x.min} max={x.max} step={1} value={x.val} onChange={(e) => x.set(+e.target.value)} aria-valuetext={x.ctlText} />
            <span className="mono ctl-val">{x.ctlText}</span>
          </div>
        </div>
      ))}

      <div className="ctl vol">
        <label htmlFor="vol">Volume</label>
        <input className="ej" id="vol" type="range" min={0} max={100} step={1} value={p.volume} onChange={(e) => p.onVolume(+e.target.value)} aria-valuetext={`${p.volume} percent`} />
        <button type="button" className={`mute mono${p.muted ? ' on' : ''}`} onClick={p.onToggleMute} aria-pressed={p.muted}>
          {p.muted ? 'MUTED' : 'MUTE'}
        </button>
      </div>

      <div className="export">
        <button type="button" className="chip wide" onClick={p.onExport} disabled={!p.canExport || p.exporting}>
          {p.exporting ? 'RENDERING…' : 'DOWNLOAD 12-FRAME WAV'}
        </button>
        <span className="note">Renders this soundscape offline with the current mapping.</span>
      </div>

      <section id="interpretation" aria-labelledby="hear-btn" className="explain">
        <h2>
          <button id="hear-btn" type="button" className="mono" onClick={p.onToggleExplain} aria-expanded={p.explainOpen} aria-controls="hear-body">
            <span>WHAT AM I HEARING?</span>
            <span aria-hidden="true" className="accent icon">{p.explainOpen ? '−' : '+'}</span>
          </button>
        </h2>
        {p.explainOpen && (
          <div id="hear-body" className="explain-body">
            <p>{explainText}</p>
            <dl>
              <dt className="eyebrow mono">DATA PROPERTY</dt><dd aria-hidden="true" /><dd className="eyebrow mono">SOUND PROPERTY</dd>
              <dt>Temperature anomaly</dt><dd aria-hidden="true" className="accent">→</dd><dd>Pitch on a pentatonic scale, higher = warmer</dd>
              <dt>Change since last frame</dt><dd aria-hidden="true" className="accent">→</dd><dd>Pulse rate, faster = quicker change</dd>
              <dt>Spread across the area</dt><dd aria-hidden="true" className="accent">→</dd><dd>Noise grain, rougher = more varied</dd>
            </dl>
            <p className="fine">
              Values come from NASA’s own map images: each pixel’s colour is matched back to a temperature through the GIBS colormap. The
              mappings to sound are design choices, not properties of the dataset. With sound off, the “In words” line under the timeline
              carries the same information.
            </p>
          </div>
        )}
      </section>
    </aside>
  );
}
