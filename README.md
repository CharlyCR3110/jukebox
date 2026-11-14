# Earth Jukebox: Listening Lab

> New to the code? Start with [docs/HANDOFF.md](docs/HANDOFF.md).

NASA Space Apps 2026 · [The Earth Information Jukebox](https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/)

Select an ocean location, press Play, and hear its sea-surface temperature change while NASA's visualization
steps through time. Warmer water gives a higher tone. A glide shows the direction of change, and the number of
pulses shows its size. Each zone also has its own instrument (mallet, pluck, brass, bell, wind) so places are recognisable by ear. The map, readout, text and sound all render from one state, and every number links to
its NASA source.

```bash
npm run setup     # install apps/web
npm run dev       # http://127.0.0.1:5173 (loopback only)
npm test          # unit tests (mapping formulas, state, manifest contract, serial protocol)
npm run build     # type-check + tests + bundle → apps/web/dist (static, no backend)
```

## Data

| Mode | What you hear | How to build |
|---|---|---|
| `measured_sst` | Measured MUR v4.1 SST (°C) at each location and date | `python scripts/prepare_data.py --mode measured` (needs a free [Earthdata Login](https://urs.earthdata.nasa.gov/users/new) via `EARTHDATA_USERNAME`/`EARTHDATA_PASSWORD` or `~/.netrc`) |
| `visual_feature` | Red–blue index of the NASA frame pixels. Labeled everywhere as **not a temperature** | `python scripts/prepare_data.py --mode visual` (no credentials) |

**Currently shipped: `visual_feature`.** Earthdata credentials were not available when the data was built. Run the
measured command once to switch; the app reads the mode from the manifest. Python setup:

```bash
uv venv scripts/.venv && source scripts/.venv/bin/activate
uv pip install -r scripts/requirements.txt
python scripts/prepare_data.py --selftest 2019-11-15   # checks extraction on the anonymous AWS MUR copy
```

Frames come from NASA SVS 5101, which is tagged “Earth Information Center” in the SVS API. Still confirm it with
EIC before submission. The default dates are 12 monthly observations, 2025-11-15 … 2026-10-15. Details, formulas
and limitations are in [docs/methodology.md](docs/methodology.md).

## Architecture

```
scripts/prepare_data.py ─► apps/web/public/data/sst/{manifest.json, frames/*.jpg}
                                  │  (contract: apps/web/src/data/manifest.ts, validated on load)
mouse ─┐                          ▼
keyboard ─┼─► intents ─► reducer (src/state/store.ts) ─► one AppState ─┬─► MapLibre view
serial ─┘    PLAY, NEXT_FRAME, SELECT_LOCATION, …                       ├─► readout + “In words” text
                                                                        └─► audio (src/audio): mapping.ts → engine.ts (Tone.js)
```

| Path | Owner (provisional) | Contents |
|---|---|---|
| `apps/web/src/state/` | Integrator | Intents, reducer, timing |
| `apps/web/src/audio/` | Audio lead | `mapping.ts` (pure, tested), `engine.ts` (Tone.js, limiter, gate) |
| `apps/web/src/input/` | Frontend / hardware | keyboard, Web Serial adapter (115200 baud, NDJSON) |
| `apps/web/src/components/` | Frontend | Map, readout, timeline, sonification panel, explainer |
| `scripts/` | Data lead | `prepare_data.py`, `locations.json` |
| `firmware/esp32/` | Hardware lead | Reference sketch (not yet compiled or tested on hardware) |
| `docs/` | Experience lead | `methodology.md`, `demo.md` (runbook, 90 s script, acceptance checklist) |

**Controller protocol:** one JSON object per line, e.g. `{"type":"NEXT_FRAME"}`. Accepted types: `PLAY`, `PAUSE`,
`TOGGLE_PLAY`, `NEXT_FRAME`, `PREV_FRAME`, `SET_FRAME{index}`, `SELECT_LOCATION{id}`, `ADJUST_LOCATION{direction:±1}`,
`SET_VOLUME{value 0–1}`, `MUTE`, `UNMUTE`. Anything else is dropped; at most 20 events/s are accepted. Needs desktop
Chrome or Edge on localhost or HTTPS. Every action is also available without the controller.

**Keyboard:** Space play/pause · ←/→ date · ↑/↓ location · M mute · Tab reaches every control.

## Not done yet (spec P1 / open items)

- Measured data build (needs Earthdata credentials) and official EIC confirmation.
- Listening Challenge (A/B comparison) and spatial-variability timbre.
- Firmware has not been compiled or run on an ESP32. The browser adapter is unit-tested against the protocol only.
- No user testing of the sound mapping or accessibility yet.
