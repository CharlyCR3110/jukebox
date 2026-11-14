import type { FrameData } from '../data/frames';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const SPEEDS = [0.5, 1, 2];

interface Props {
  frames: FrameData[];
  frame: number;
  playing: boolean;
  speed: number;
  series: number[];
  rates: number[];
  scope: string;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onSpeed: (s: number) => void;
  onScrub: (f: number) => void;
}

export function Timeline(p: Props) {
  const F = p.frames[p.frame];
  const amax = Math.max(0.01, ...p.series.map(Math.abs));
  const rmax = Math.max(0.01, ...p.rates.map(Math.abs));
  const trace = p.series.map((v, i) => `${i ? 'L' : 'M'}${((i / 11) * 1200).toFixed(1)} ${(32 - (v / amax) * 24).toFixed(1)}`).join(' ');
  const ticks = p.rates.map((v, i) => `M${((i / 11) * 1200).toFixed(1)} 63V${(63 - (Math.abs(v) / rmax) * 26).toFixed(1)}`).join(' ');
  const num = String(p.frame + 1).padStart(2, '0');

  return (
    <div className="timeline">
      <div className="tl-row">
        <div role="group" aria-label="Transport" className="transport">
          <button type="button" className="tbtn" onClick={p.onPrev} aria-label="Previous frame">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#E8E9E2" strokeWidth="1.5" aria-hidden="true"><path d="M3 2v10M11 2 5 7l6 5" /></svg>
          </button>
          <button type="button" className="tbtn play" onClick={p.onTogglePlay} aria-label={p.playing ? 'Pause sonification' : 'Play sonification'}>
            {p.playing ? (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2" width="3" height="10" fill="#101311" /><rect x="8" y="2" width="3" height="10" fill="#101311" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2v10l8-5z" fill="#101311" /></svg>
            )}
          </button>
          <button type="button" className="tbtn" onClick={p.onNext} aria-label="Next frame">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#E8E9E2" strokeWidth="1.5" aria-hidden="true"><path d="M11 2v10M3 2l6 5-6 5" /></svg>
          </button>
        </div>
        <div className="mono frame-count">
          <span className="big">{num}<span className="muted"> / 12</span></span>
          <span className="small muted">{F.m} · {(1.6 / p.speed).toFixed(1)} s per frame</span>
        </div>
        <div className="speed">
          <span id="speed-label" className="eyebrow mono">SPEED</span>
          <div role="group" aria-labelledby="speed-label" className="seg">
            {SPEEDS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={p.speed === v}
                className={`seg-btn mono${p.speed === v ? ' on' : ''}`}
                onClick={() => p.onSpeed(v)}
              >
                {v}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="trace-wrap">
        <div className="trace-legend mono">
          <span><span className="accent">━</span> PITCH SOURCE (ANOMALY)   <span className="fg">┃</span> PULSE RATE (CHANGE)</span>
          <span>TRACE · NASA MUR SST · {p.scope}</span>
        </div>
        <div className="trace">
          <svg viewBox="0 0 1200 64" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 32H1200" stroke="#3A413D" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
            <path d={ticks} stroke="#929B96" strokeWidth="3" vectorEffect="non-scaling-stroke" fill="none" />
            <path d={trace} stroke="#B8E36A" strokeWidth="2" vectorEffect="non-scaling-stroke" fill="none" strokeLinejoin="round" />
          </svg>
          <input
            className="scrub"
            type="range"
            min={0}
            max={11}
            step={1}
            value={p.frame}
            onChange={(e) => p.onScrub(+e.target.value)}
            aria-label="Timeline: scrub frames"
            aria-valuetext={`Frame ${p.frame + 1} of 12, ${F.long.toLowerCase()} ${F.date.slice(0, 4)}`}
          />
        </div>
        <div aria-hidden="true" className="months mono">
          {p.frames.map((f, i) => (
            <span key={f.date} style={{ left: pct(i / 11), color: i === p.frame ? '#E8E9E2' : '#929B96' }}>{f.m}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
