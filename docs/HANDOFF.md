# Earth Jukebox: developer handoff

Read this first if you're joining the project. It explains what exists, how the pieces connect, where to
change things, and what's unfinished. For the science and formulas see [methodology.md](methodology.md). For
running the demo see [demo.md](demo.md).

---

## 1. What it is, in one paragraph

A static web app ("Listening Lab") that steps through 12 monthly frames of NASA's sea-surface temperature
visualization (SVS 5101). For a selected ocean location it plays a tone whose pitch, glide and pulse count
come from that location's value and its change since the previous month. A Python script prepares all data
ahead of time into one `manifest.json` plus images. The browser never calls a NASA API at runtime, and there is
no backend. Mouse, keyboard and an optional ESP32 knob all drive the same app state.

## 2. Get it running (5 minutes)

```bash
npm run setup          # npm install inside apps/web
npm run dev            # http://127.0.0.1:5173
npm test               # 31 unit tests (vitest)
npm run build          # tsc + tests + vite build → apps/web/dist
```

Requirements: Node 20+ (developed on 24). Python 3.12 is only needed if you regenerate data. Use desktop Chrome or Edge
for the serial controller.

The repo ships with prepared data (`apps/web/public/data/sst/`), so you don't need Python or NASA access to work
on the frontend.

## 3. Repository map

```
jukebox/
├── package.json                  root shortcuts → apps/web (setup/dev/test/build/preview)
├── README.md                     overview
├── docs/
│   ├── HANDOFF.md                this file
│   ├── methodology.md            sources, extraction, formulas, limitations
│   └── demo.md                   runbook, 90 s script, acceptance checklist
├── scripts/
│   ├── prepare_data.py           data pipeline (run once, offline)
│   ├── locations.json            the preset ocean locations (id, name, lat, lon)
│   └── requirements.txt          Python deps
├── firmware/esp32/earth_jukebox_controller/earth_jukebox_controller.ino   reference controller sketch
└── apps/web/                     React + TypeScript + Vite app
    ├── public/data/sst/          GENERATED: manifest.json + frames/*.jpg (do not hand-edit)
    └── src/
        ├── main.tsx              entry; imports bundled fonts + styles
        ├── App.tsx               wiring: loads manifest, owns reducer, drives audio, renders layout
        ├── styles.css            all styling (CSS variables at top = design tokens)
        ├── data/manifest.ts      data contract types, validateManifest(), loadManifest()
        ├── state/store.ts        AppState, Intent union, reducer(), frameInterval()
        ├── audio/mapping.ts      PURE data→sound rules + text description
        ├── audio/voices.ts       zone instrument table (identity timbre per location)
        ├── audio/engine.ts       Tone.js synthesis, scheduling, limiter, pause gate
        ├── input/keyboard.ts     global shortcuts → intents
        ├── input/serial.ts       Web Serial adapter: parse, validate, rate-limit → intents
        ├── components/MapView.tsx   MapLibre map, frame layers, location markers, click → location
        ├── components/Panels.tsx    Header, Readout, Timeline, SoundPanel, Explainer
        └── test/fixtures.ts      synthetic manifest for tests only
```

`*.test.ts` files sit next to the code they test.

## 4. Architecture

```
            ┌─────────────── build time (Python) ───────────────┐
NASA SVS 5101 EXR frames ──►│ prepare_data.py                                   │
NASA MUR v4.1 (Earthdata) ─►│  sRGB + Web Mercator JPEGs, point values, deltas  │──► public/data/sst/
                            └───────────────────────────────────────────────────┘     manifest.json + frames/

            ┌──────────────────────── run time (browser) ────────────────────────┐
            │  loadManifest() → validateManifest()                               │
            │                                                                    │
 mouse ─────┤                                                                    │
 keyboard ──┼─► Intent ─► reducer ─► AppState ─┬─► MapView (frame + marker)       │
 serial ────┤   (state/store.ts)               ├─► Readout / Timeline / In words  │
            │                                  └─► cueFor() ─► AudioEngine        │
            │                                      (mapping.ts)  (engine.ts)      │
            └────────────────────────────────────────────────────────────────────┘
```

### Design rules (please keep them)

1. **One source of truth.** `AppState` in `state/store.ts` holds frame, location, playing, muted, volume, speed and
   controller state. Nothing else stores these. Inputs never touch audio or the DOM directly; they dispatch an
   `Intent`.
2. **The manifest is read-only data.** All displayed numbers come from `manifest.json`. The frontend never computes
   a temperature. It only maps values to sound and text.
5. **Identity is not data.** Zone instruments change tone colour only and are labelled as a design choice.
3. **Mapping is pure.** `audio/mapping.ts` has no Tone.js, no DOM and no state. Same input, same cue. That's
   why it's fully unit-tested and why the UI can show "24.0 °C → 673 Hz" exactly.
4. **Honest data modes.** `dataMode` is either `measured_sst` or `visual_feature`. In visual mode nothing may be
   labeled °C. The validator rejects `sstC` in that mode, and the UI shows a banner.

## 5. How each part works

### 5.1 Data contract: `src/data/manifest.ts`

`Manifest` → `frames[]` (8–24, dates strictly increasing) → `points[locationId]`:

| Field | Meaning |
|---|---|
| `sstC` | Measured °C, or `null` (invalid point, or visual mode) |
| `deltaC` | `sstC(t) − sstC(t−1)`. `null` on the first frame or when either value is invalid |
| `isValid` | ≥ 50 % of the sampling box was open-sea data |
| `feature`, `featureDelta` | Visual mode only: red–blue index −1…1 and its change |
| `coverage`, `nCells`, `spatialStdC` | Diagnostics (σ is exported but not sonified) |

Frame-level fields: `date`, `imageUrl` (relative to `public/`), `sourceUrl` (exact NASA file),
`daysSincePrevious`, and `numericSourceUrl` (measured mode).

`validateManifest()` returns a list of human-readable violations. `loadManifest()` throws if the list isn't empty,
and the app shows the error instead of rendering wrong data. If you change the shape, update the Python
writer, the TS types, the validator and `test/fixtures.ts` together.

### 5.2 State: `src/state/store.ts`

`reducer(state, intent)` is a plain function with no side effects. Notable behaviour:
- `PLAY` is ignored until `INIT` has set `frameCount` (no data, no playback).
- Frame steps wrap around; `SET_FRAME` clamps; unknown location ids are ignored.
- `EXTERNAL_INTENTS` lists which intents the serial controller may send (`INIT` and `CONTROLLER` are internal).
- `frameInterval(speed)`: 1 s at 1×, 0.5 s at 2×.

### 5.3 Sound rules: `src/audio/mapping.ts`

- `frequencyForSst(c) = 220 + clamp(c, 0, 35)/35 × 660`, plus a `clamped` flag.
- `directionForDelta(d)`: `rising`, `falling`, `unchanged` (|d| < 0.05 °C) or `unavailable` (null).
- `pulsesForDelta(d)`: 1 + round(min(|d|, 2)/2 × 4) gives 1…5, plus a `capped` flag.
- `cueFor(point, mode)` → `SoundCue { frequencyHz | null, direction, pulses, … , silentReason }`. `null` frequency
  means silence; the reason is shown in the UI.
- `describe(...)` builds the "In words" sentence. It's the non-audio equivalent of the sound, so keep it in sync with
  any mapping change.

All tunable constants (`PITCH`, `DELTA_MAX_C`, `UNCHANGED_C`, `FEATURE_*`) are at the top of the file. If you change
one, update `mapping.test.ts`, the Explainer text in `Panels.tsx`, and `methodology.md`.

### 5.3b Zone instruments: `src/audio/voices.ts`

Each location id maps to a `VoiceDef { kind, name, why, trimDb }`. Unknown ids, or the “Zone instruments”
toggle off (`AppState.zoneVoices`, persisted), fall back to `UNIFORM_VOICE` (triangle). Voices only change
**tone colour**. `cueFor()` takes no voice input, so data → pitch/glide/pulses is the same for every zone. The
instrument name appears in the panel, the explainer and the “In words” sentence.

`trimDb` values were calibrated in the browser so all voices are within ~1 dB of the uniform tone. If you change an
instrument's envelope or oscillator, re-measure: play a 440 Hz test cue through `window.__ej.engine.play(cue, 2,
() => silent, window.__ej.voices.<id>)` in dev and compare the peak RMS of `engine.wave`. Keep each instrument's
decay longer than the 120 ms glide, or the rising/falling cue becomes inaudible (this happened to the pluck).

### 5.4 Audio engine: `src/audio/engine.ts`

Signal chain: `zone instrument (buildInstrument) → voiceGain → gate → Volume → Limiter(−3 dB) → speakers` (+ FFT and Waveform taps).
`buildInstrument(def)` creates the Tone.js synth for a voice kind (FMSynth, MonoSynth, or Synth + filtered noise for wind). It exposes one method, `note(freq, dur, time, from?)`.

| Method | What it does |
|---|---|
| `ensure()` | Starts the AudioContext. **Must be called from a user gesture** (browser autoplay rule). |
| `play(currentCue, interval, next, voice)` | Builds `voice`, plays `currentCue` now, then every `interval` s calls `next(time)` on the audio clock and renders the cue it returns. |
| `stop()` | Clears the schedule, closes the gate on the *immediate* clock, swaps in a fresh voice. |
| `setOutput(volume, muted)` | 40 ms volume ramp. |
| `levels()` / `peak()` | Meter bars / raw output peak (used to verify silence). |

**Gotcha, already fixed:** Tone's monophonic `Synth` can't unschedule notes, and it throws if a note is scheduled
earlier than one already queued. That happened when restarting mid-frame and froze playback. `newVoice()`
therefore fades out and disposes the old synth and creates a new one on every `play()` and `stop()`. Don't
"simplify" this back to reusing one synth.

Tone schedules ~100 ms ahead (`lookAhead`). Leave the default: setting it to 0.05 stopped the transport from ticking.

### 5.5 Playback wiring: `App.tsx`

- `act(intent)` is the single entry point for all inputs. For `PLAY`/`TOGGLE_PLAY` it calls `engine.ensure()`
  synchronously inside the gesture, then dispatches.
- The audio `useEffect` watches `playing / frameIndex / locationId / speed / voice`. When any changes during playback it
  restarts the engine from the current state, so changes are heard immediately.
- The engine's `next(time)` callback advances `played.current.frame` and schedules
  `dispatch(SET_FRAME)` with `Tone.getDraw()` at the same audio time. This keeps picture and sound in sync. Because
  `played.current` already matches, that dispatch does not trigger another restart.
- `live` ref = latest state/manifest for callbacks running on the audio clock (avoids stale closures).
- Mute and volume persist in `localStorage` (`earth-jukebox:audio`).
- Dev only: `window.__ej = { engine, Tone }` for debugging and browser tests (stripped from production builds).

### 5.6 Map: `components/MapView.tsx`

- MapLibre GL 6 with a minimal inline style (background + graticule). There's no basemap; the NASA frames include land.
- One `image` source/layer per frame, all loaded at start. Changing frames just toggles `raster-opacity` (instant,
  no network).
- Frames are pre-reprojected to Web Mercator by the script and placed at ±85.0511°, so screen ↔ lat/lon is exact.
- A click picks the nearest preset location within 2,500 km. Otherwise `onMiss` shows a notice. There's no free-form
  probe, because values only exist for prepared points.
- `setWorkerUrl(workerUrl)` is required: MapLibre 6 finds its worker relative to its own file, and bundling breaks
  that. Keep the `?url` import.
- The map is supplementary. Keyboard and screen-reader users choose locations from the list in the panel; markers aren't tab stops.

### 5.7 Inputs: `src/input/`

- **keyboard.ts:** Space, ←/→, ↑/↓ and M. Ignored while focus is in inputs, selects, buttons or `[data-own-keys]`, so native
  controls keep their own key handling.
- **serial.ts:** `connectSerial()` opens the port at 115200 baud and reads newline-delimited JSON. `parseLine()` accepts only
  `EXTERNAL_INTENTS` with valid arguments (max line 256 chars). `rateLimiter()` allows 20 events/s. On unplug it reports
  "disconnected"; playback continues.

### 5.8 Data pipeline: `scripts/prepare_data.py`

```bash
uv venv scripts/.venv && source scripts/.venv/bin/activate && uv pip install -r scripts/requirements.txt
python scripts/prepare_data.py --selftest 2019-11-15     # check extraction (anonymous AWS MUR copy, ≤ 2019)
python scripts/prepare_data.py --mode visual             # no credentials
python scripts/prepare_data.py --mode measured           # needs Earthdata Login
python scripts/prepare_data.py --mode measured --monthly 2025-06 2026-05
python scripts/prepare_data.py --mode measured --dates 2026-01-15,2026-02-15,…
```

Steps: check that the dates exist in the SVS listing, then download the EXRs (cached in `scripts/.cache/`). Convert each to
sRGB, remap rows to Mercator and save a 2048² JPEG. Extract point values (measured: ±0.05° box mean of open-sea
cells, °C, `deltaC`; visual: red–blue index). Sample the SVS colorbar for the legend, then write the manifest.

Earthdata credentials: `EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD` env vars, or `~/.netrc` (`machine urs.earthdata.nasa.gov login … password …`, chmod 600).
**Never** put credentials in the frontend or commit them.

To add or move locations, edit `scripts/locations.json` and rerun the script. The frontend picks them up automatically
(at least 3 are required).

### 5.9 Firmware: `firmware/esp32/…ino`

Rotary turn sends `NEXT_FRAME`/`PREV_FRAME`, rotary push sends `ADJUST_LOCATION +1`, and the button sends `TOGGLE_PLAY`. It also sends
`HELLO` on boot, which the app ignores. Quadrature decoding uses a state table, buttons are debounced at 30 ms, and the LED blinks on each event.
Pins are defined at the top. **Not yet compiled or tested on hardware.**

## 6. Common tasks

| I want to… | Change |
|---|---|
| Tweak a sound rule | `audio/mapping.ts` constants → `mapping.test.ts` → Explainer in `Panels.tsx` → `methodology.md` |
| Change a zone's instrument | `ZONE_VOICES` in `audio/voices.ts` (name, why, trim) and `buildInstrument()` in `engine.ts` (sound). Re-check loudness and glide (§5.3b) |
| Give a new location a voice | Add its id to `ZONE_VOICES`; otherwise it uses the uniform tone |
| Add a control intent | `Intent` + `reducer` in `store.ts` → (optional) `EXTERNAL_INTENTS` + `parseLine` → dispatch from UI/keyboard → tests |
| Add a UI panel | New component in `components/`, fed from `App.tsx` derived values (`frame`, `point`, `cue`) |
| Use different dates | `prepare_data.py --monthly` or `--dates`, then commit the new `public/data/sst/` |
| Restyle | Tokens at the top of `styles.css`; spec v1.0 additions at the bottom; mobile under `@media (max-width: 900px)` |
| Deploy | `npm run build`, then upload `apps/web/dist/` to any static host. It's public content, no auth needed. Web Serial needs HTTPS. |

## 7. Testing

- `npm test`: mapping formulas (spec examples), reducer, manifest validator (including the shipped manifest), serial
  parser, rate limiter, keyboard map.
- Browser checks done manually with Playwright so far (not yet automated in the repo):
  - frame / date / text stay in sync during playback
  - 1× and 2× timing
  - speed and location changes mid-play
  - silent after Pause within ~80 ms
  - mute persists across reloads
  - Tab order reaches every control
  - works with all external network blocked
  - mobile layout at 390 px

  Turning these into a Playwright test file is a good first task.

## 8. Known gaps and next steps (by priority)

1. **Measured data.** Get an Earthdata Login and run `--mode measured`. The Earthdata branch of the script hasn't been run yet;
   its extraction function is the same one the self-test validated. Check the output values look plausible
   before the demo.
2. **EIC confirmation.** SVS 5101 has the "Earth Information Center" keyword, but confirm with the EIC content database.
3. **Firmware.** Compile, flash, test on hardware, and adjust pins.
4. **Listening Challenge** (spec P1): A/B comparison mode.
5. **Automated browser tests** (see §7).
6. **User testing** of the sound mapping and accessibility. Nothing has been tested with real listeners yet.
7. Bundle size: the main JS chunk is ~1.5 MB, mostly MapLibre and Tone. Fine for a demo; code-split if hosting publicly.

## 9. Gotchas cheat-sheet

- No sound? The AudioContext only starts after a click or key press. Check the header audio status.
- `manifest.json failed validation` on load: the data and code disagree. Rerun the script or fix the validator, never hand-edit the data.
- MapLibre worker 404: someone removed `setWorkerUrl(workerUrl)` from `MapView.tsx`.
- Dev and preview servers bind to `127.0.0.1` only (`vite.config.ts`). Keep it that way. To show a teammate, deploy
  the static build instead of opening the dev server to the network.
- MapLibre is pinned to 6.x on purpose: 5.x has a critical XSS advisory.
