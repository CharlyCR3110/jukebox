import type { DatasetDef } from '../data/datasets';

export function Header(props: { soundText: string; soundDot: string; muted: boolean; onToggleMute: () => void }) {
  return (
    <header className="hdr">
      <a href="#" aria-label="Earth Jukebox home" className="brand">
        <span className="brand-a">EARTH</span>
        <span className="brand-slash mono">/</span>
        <span className="brand-b mono">JUKEBOX</span>
      </a>
      <nav aria-label="Primary" className="nav">
        <a href="#" aria-current="page">Explore</a>
        <a href="#interpretation">How it works</a>
        <a href="#about">About</a>
      </nav>
      <div className="hdr-right mono">
        <span>CONTROLLER <span className="fg">NOT CONNECTED</span></span>
        <button
          type="button"
          className="sound-btn mono"
          onClick={props.onToggleMute}
          aria-pressed={props.muted}
          aria-label={`Sound: ${props.soundText.toLowerCase()}. Toggle mute.`}
        >
          <span aria-hidden="true" className="dot" style={{ background: props.soundDot }} />
          <span>{props.soundText}</span>
        </button>
      </div>
    </header>
  );
}

export function DatasetBar(props: {
  datasets: DatasetDef[];
  year: number;
  minYear: number;
  maxYear: number;
  notice: string;
  onPick: (d: DatasetDef) => void;
  onYear: (y: number) => void;
}) {
  const years: number[] = [];
  for (let y = props.maxYear; y >= props.minYear; y--) years.push(y);
  return (
    <div role="group" aria-label="Dataset" className="dsbar">
      <span className="eyebrow mono">DATASET</span>
      {props.datasets.map((d) => (
        <button
          key={d.id}
          type="button"
          className={`ds-btn${d.ready ? ' on' : ''}`}
          onClick={() => props.onPick(d)}
          aria-pressed={d.ready}
          aria-disabled={!d.ready}
        >
          <span>{d.name}</span>
          <span className="ds-tag mono">{d.ready ? 'ACTIVE' : 'UPCOMING'}</span>
        </button>
      ))}
      <label htmlFor="year" className="eyebrow mono year-label">YEAR</label>
      <div className="select-wrap year-wrap">
        <select id="year" className="ej" value={props.year} onChange={(e) => props.onYear(+e.target.value)}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <Chevron />
      </div>
      <span role="status" className="ds-notice">{props.notice}</span>
    </div>
  );
}

export function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="chev">
      <path d="M1 3l4 4 4-4" stroke="#929B96" fill="none" strokeWidth="1.5" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer id="about" className="ftr">
      <span>Earth Jukebox · NASA Space Apps Challenge prototype · Imagery: NASA GIBS · Data: JPL MUR SST (PO.DAAC)</span>
      <span>Keyboard: Tab through controls · ←/→ on the timeline steps frames · arrows on the map move the probe (Shift = 1°) · Esc returns to the global mean</span>
    </footer>
  );
}
