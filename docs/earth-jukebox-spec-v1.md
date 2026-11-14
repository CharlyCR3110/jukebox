# Earth Jukebox — Product & Engineering Specification

**Version:** 1.0 (hackathon MVP)  
**Event:** NASA Space Apps Challenge, November 14–15, 2026  
**Status:** Proposed architecture; team approval and source validation pending  
**Product statement:** Explore real changes in Earth observations through synchronized visuals, real-time sound, and optional tangible controls.

## 1. Problem and goal

Earth observation is often communicated primarily through images. Earth Jukebox turns a verified sequence of Earth science observations into an accessible, interactive listening experience. The core value is **scientific interpretation**, not generated background music.

**Primary goal:** A visitor can select an ocean location, hear its measured sea-surface temperature change as the timeline advances, and explain what the sound represents.

**Challenge alignment:** Pair Earth Information Center (EIC) visual frames with dynamic sonification generated in real time. The team must verify that the selected visual source qualifies as an EIC visualization; NASA Scientific Visualization Studio (SVS) imagery alone should not be represented as EIC content without that verification.

**One-sentence pitch:** A hands-on Earth instrument that lets people see, hear, and explore how our planet changes.

## 2. MVP scope and boundaries

### Required (P0)

- One verified Earth science visualization with 8–24 frames across explicitly identified observation dates.
- Corresponding authentic numeric observations, or a clearly labeled frame-feature mode if numeric values cannot be verified.
- A clickable geographic selection or a preset list of at least three ocean locations.
- A synchronized timeline with play/pause, scrub, selected date, and playback speed.
- Browser-generated audio whose pitch and temporal pattern depend deterministically on the current observations.
- An always-visible explanation of the data-to-sound mapping, source attribution, units, and missing-data states.
- Working mouse, keyboard, and non-audio exploration paths.
- A stable deployable demo, repository, README, and a 90-second demonstration script.

### Differentiators (P1, only after P0 works)

- ESP32 console using USB serial: rotary encoder for timeline, joystick or encoder for selecting location, button for play/pause.
- Guided **Listening Challenge** comparing two locations without requiring visual cues, followed by a data-based reveal.
- Additional sound parameter for local spatial variability, if the calculation and mapping can be tested.

### Explicitly out of scope

- Multiple datasets, generative AI narration, accounts, databases, real-time satellite ingestion, cloud streaming, multiplayer, elaborate 3D globe, machine-learning predictions, fully fledged music composition, unsupported climate conclusions.

## 3. Users and core journeys

**Curious visitor:** Opens the app, presses Play, clicks an ocean location, hears the sound change, reads the temperature and its scientific interpretation.

**Keyboard-only / low-vision visitor:** Tabs to an accessible preset region selector, uses buttons to move through dates, hears audio or reads an equivalent text description, and never needs to interact with the map.

**Exhibit visitor:** Connects the physical controller, moves through regions and dates, and sees/hears the same changes reflected immediately in the web interface.

**Evaluator:** Inspects the data source, selected dates, audio mapping formula, sample calculation, and distinction between measured data and sound settings.

## 4. Main application UI

**Single screen: Listening Lab.** No separate marketing landing page.

1. **Header:** Earth Jukebox wordmark; dataset and source identity; audio status; optional controller state.
2. **Earth view (primary area):** Scientifically sourced frame, date, color scale, selected location marker, and clear placeholder flag if relevant. Correct map projection is mandatory for click-to-coordinate handling.
3. **Observation readout:** Region name/coordinates, sea-surface temperature (°C), change from previous observation (°C), and data validity.
4. **Sonification panel:** Play/mute/volume, output mapping, current sound state; sound personalization must not change the underlying numeric readings.
5. **Timeline:** Frame step, play/pause, scrub, speed (1×/2×); selected date and image/audio synchronized.
6. **“What am I hearing?” panel:** One concise statement per mapping and a text alternative for each observation.
7. **Optional Listening Challenge:** A/B location selector, listen to A and B, make a choice, reveal data and mapping.

**Mobile:** Map first; sticky playback; compact observation readout; accordion for advanced mappings. Physical serial connection is not required on mobile.

## 5. Scientific data specification

### Candidate NASA source

- **Visual frames:** NASA SVS visualization **5101**, *Sea Surface Temperature (SST) — Near Real Time*, which provides downloadable equirectangular frame sets: https://svs.gsfc.nasa.gov/5101/
- **Underlying analysis:** GHRSST Level 4 MUR Global Foundation Sea Surface Temperature Analysis v4.1, NASA JPL/PO.DAAC: https://podaac.jpl.nasa.gov/dataset/MUR-JPL-L4-GLOB-v4.1
- **Source caveat:** Confirm whether this visualization is presented through EIC or select a confirmed EIC asset before submission. Identify the actual observational dates represented by each downloaded frame.

### Data preparation

1. Choose 8–24 **actual available** observation dates with matching imagery and numerical values. Do not call a monthly sequence “daily” or imply equally spaced dates if it is not.
2. Download/subset only the relevant MUR dataset and dates offline. NASA Earthdata access may require credentials; do not expose them in frontend code.
3. Prepare a small, transparent set of ocean locations. For each location/date, compute the valid sea-surface temperature from a documented grid point or neighborhood statistic; retain the sampling method and coverage.
4. Convert temperature units correctly to °C according to the dataset variable metadata. Preserve source fill values/masks; do not treat land or missing observations as zero.
5. Compute signed temporal change `deltaC = valueC(t) - valueC(previous observation)` only when both observations are valid. Display it as **change since previous selected observation**, not as a climate anomaly.
6. Optionally calculate the standard deviation over a documented neighborhood for timbre. Do not use variability until its interpretation is tested.
7. Export optimized web images plus `manifest.json`; confirm frame date, numerical date, location, and citations match.

### Provenance rule

Every displayed scientific number must trace to a real source file and a reproducible transformation. Do not infer temperature from a decorative mockup, a compressed color image, or synthetic samples and label it measured SST.

**Fallback if numerical acquisition blocks progress:** Use confirmed EIC visual frames and compute real-time audiovisual features from those frames (e.g., per-region mean luminance or motion between frames); label each feature as a property of the visualization, **not** a physical temperature measurement. This is a reduced scientific interpretation mode, not an equivalent substitute for real measurements.

## 6. Data model and contract

Each `FrameObservation` must include:

- `frameId` (string), `date` (ISO calendar date), `imageUrl` (local/hosted asset path), `sourceUrl` (URL), `datasetId` (string).
- `points`: keyed by location ID; each value includes `lat`, `lon`, `sstC` (nullable), `deltaC` (nullable), `isValid`, and optional `spatialStdC` (nullable).
- `samplingMethod`, `dataMode` (`measured_sst` or `visual_feature`), and `units` as explicit metadata.

Each control event must be an intent, not raw audio output: `PLAY`, `PAUSE`, `NEXT_FRAME`, `PREV_FRAME`, `SET_FRAME(index)`, `SELECT_LOCATION(id)`, `ADJUST_LOCATION(direction)`, `SET_VOLUME(value)`, `MUTE`, `UNMUTE`.

Single application state is authoritative: `frameIndex`, `locationId`, `playing`, `muted`, `volume`, `speed`, `controllerConnected`. Mouse, keyboard, and hardware update that same state, and audio renders from it.

## 7. Real-time sonification specification

**Engine:** Web Audio API, optionally Tone.js; synthesis occurs in the browser at playback time. A precomputed JSON file is acceptable; prerecorded soundtracks do not satisfy the real-time requirement.

**Proposed mappings, to be tested and disclosed:**

- **Pitch:** Absolute SST controls oscillator frequency using a fixed, labeled linear mapping: `frequencyHz = 220 + clamp(sstC, 0, 35) / 35 * 660`. The UI describes this as “warmer water produces a higher tone.” Values outside the mapped range are clamped and explicitly indicated if they occur.
- **Direction of change:** Rising SST produces a short upward glide; falling SST produces a downward glide; unchanged produces a stable onset. If `deltaC` is unavailable, disable the direction cue rather than inventing a trend.
- **Magnitude of change:** Pulse rate reflects `abs(deltaC)` using a documented range (for example, 1–5 pulses per observation), with a displayed legend and capped extremes. Explain that pulse rate means **change between the displayed observations**, not real-world change per second.
- **Optional timbre (P1):** Local spatial standard deviation modulates a secondary harmonic. Keep disabled unless data and interpretation are reliable.

**Audio behavior:** Default muted until user activation, safe default volume, persistent mute, master limiter, smooth 30–80 ms transitions between frames, no random melodies, and silence or explicit notification for missing data. At 1× playback use a fixed interval (e.g., one second per selected frame); 2× halves the interval. Audio changes within 200 ms of state updates on target demo hardware. Sound must never continue after Pause.

**Explainability requirement:** For any selected frame/location, the app displays the numeric input and derived sound output (e.g., `SST: 24.0 °C → 673 Hz`), making the mapping inspectable and reproducible.

## 8. ESP32 hardware specification (P1)

**Minimum physical inputs:** One rotary encoder with push switch, one momentary button, USB-capable ESP32 board, and a status LED. Joystick optional if available; knobs/controls should have tactile labels.

**Controls:**

- Rotary clockwise/counterclockwise → next/previous time frame.
- Rotary press → next preset ocean location.
- Button → play/pause.
- Status LED → connected/ready state; optional haptic motor only after reliable controller operation.

**Communication:** USB serial at a documented baud rate (e.g., 115200), newline-delimited JSON messages. Example: `{"type":"NEXT_FRAME"}`. Firmware debounces controls; browser validates message type and rate-limits events. Connection is user-initiated, permissions are handled gracefully, and disconnect never crashes the app.

**Browser target:** Desktop Chrome or Edge on a secure context / localhost. Web Serial is not universally supported; software controls must offer feature parity. Do not require Bluetooth, WebSockets, or a custom native bridge for MVP.

## 9. Technology architecture

**Frontend:** React + TypeScript + Vite or Next.js static deployment; CSS/Tailwind; SVG/canvas or an image layer for the geographic frame; Web Audio API / Tone.js.

**Preprocessing:** Python with xarray/netCDF tooling and NumPy; optionally Pillow for downsampling/thumbnail generation.

**Assets:** Versioned static `manifest.json`, preprocessed data, optimized scientific frame images. Hosting via a static site provider; no production backend required.

**Input adapters:** `mouse`, `keyboard`, and optional `serial` produce events consumed by one state controller. The `sonification` module converts observations and state into audio parameters. The visualization and textual interpretation observe the same state.

**Suggested repository:**

- `apps/web/` — Listening Lab UI and playback
- `apps/web/src/audio/` — sonification mapping and synthesis
- `apps/web/src/input/` — keyboard, map, and serial adapters
- `apps/web/public/data/` — manifest and selected imagery
- `scripts/prepare_data.py` — reproducible NASA dataset preprocessing
- `firmware/esp32/` — controller code
- `docs/methodology.md` — exact data source, transforms, audio mapping
- `docs/demo.md` — runbook and fallback plan

## 10. Nonfunctional requirements

- **Scientific integrity:** Correct units, dates, coordinate-to-pixel transform, source citations, honest invalid values, disclosed mapping.
- **Responsiveness:** Local timeline and audio changes under ~200 ms on target laptop; no server request on every frame.
- **Reliability:** Complete demo works offline after initial load or with locally cached/preloaded assets; hardware is optional.
- **Accessibility:** All controls keyboard operable, visible focus, descriptive labels, text alternative for sound and map, sufficient contrast, no color-only status, reduced-motion support, no autoplay audio.
- **Safety:** Avoid sudden loud sounds; cap gain and use limiter; no credential leakage.
- **Performance:** Preload neighboring frames and avoid unnecessary 4K frame payloads; use 1024–2048px optimized assets where appropriate.

## 11. Acceptance tests / definition of done

1. A user can start playback and see a NASA-derived visual frame and its correct observation date.
2. A user can select one of three valid ocean locations without needing a map; the selected coordinates and measured values update.
3. During timeline playback, the frame, date, value, textual interpretation, and sound always refer to the same observation index.
4. For two known SST values, the pitch is predictable using the documented formula; a warmer value yields a higher frequency.
5. Rising, falling, unchanged, and missing-data scenarios produce the expected distinct behavior, with no fabricated values.
6. Pausing halts audio; muting and volume controls work; no sound plays before user interaction.
7. Keyboard-only users can select a region, change dates, and read the same information as mouse users.
8. Reloading without the controller preserves full app functionality; connection/disconnection does not break playback.
9. Every measured value and visual frame has a source, date, units, and documented extraction method.
10. The team can complete a clean 90-second demo on a second laptop/browser using the README instructions.

## 12. Team workstreams (six people; provisional)

1. **Technical integrator — you:** application state contract, repo setup, architecture, wiring UI/data/audio/hardware, deployment, end-to-end tests.
2. **Hardware lead — Fátima:** ESP32, enclosure or mock physical panel, serial event protocol, testing.
3. **Frontend collaborator — your Systems Engineering friend (if interested):** map interaction, responsive UI, keyboard controls, states.
4. **Data lead — assign at kickoff:** EIC provenance check, NASA dataset acquisition, date alignment, reproducible preprocessing.
5. **Audio lead — assign at kickoff:** implement oscillator/pulse/glide mapping, limiter, audio QA, methodology.
6. **Experience/testing lead — assign at kickoff:** scientific explainer, accessibility, guided comparison challenge, demo narrative.

Roles are subject to actual skills and interest. Pair the data and audio leads immediately so the algorithm is scientifically meaningful.

## 13. Execution plan (timeboxed, relative to kickoff)

**0–90 minutes — feasibility gate:** Locate a confirmed EIC visualization; inspect available source frames and numeric data; pick exact dates and 3 locations. Run a tiny proof of concept that changes audio pitch when one validated value changes. Decide at this gate whether to use `measured_sst` or labeled `visual_feature` mode.

**Next 3–5 hours — vertical slice:** Produce a 3-frame manifest, real sound engine, one region selector, and synchronized playback. Deploy early.

**Middle phase — functional MVP:** Extend to 8–24 verified frames, add source notes, full timeline, keyboard accessibility, mapping explanation, and automated unit tests.

**Then — hardware integration:** Connect and validate ESP32; preserve UI fallback. Introduce guided A/B challenge only if core system is stable.

**Final phase — freeze and submit:** Regression testing, accessibility walkthrough, second-machine demonstration, repository README, project write-up, 90-second video, source/credit audit. Reserve a buffer before the official submission deadline; do not implement new features during this phase.

## 14. Demo script (90 seconds)

- **0–15s:** “Most Earth science is shown through images. Earth Jukebox adds an interpretable sound layer.” Show a real NASA-derived visual frame and source/date.
- **15–35s:** Select one ocean location; highlight measured SST and hear its pitch. Point to the formula explaining why.
- **35–55s:** Move the time dial or scrub timeline; show date, numeric change, frame, and audio updating together.
- **55–70s:** Switch to a second region or guided audio-only comparison; explain what the listener should recognize.
- **70–90s:** Show optional ESP32 control, accessibility fallback, and reproducible source/methodology. Close with the value: “Explore Earth without relying on sight alone.”

## 15. Risks and decisions to resolve today

| Risk | Mitigation / decision |
|---|---|
| NASA SVS visual is not confirmed to be EIC content | Confirm EIC association immediately or replace imagery with confirmed EIC frames. |
| MUR data download or authentication is slow | Subset a tiny range; use confirmed frame-feature sonification as explicitly labeled fallback. |
| Video/image frames don't match numeric observation timestamps | Use exact common dates; never interpolate silently across nonmatching frames. |
| Six people work in parallel without compatible contracts | Freeze manifest and event types before splitting work. |
| Sound is merely pleasant, not informational | Show exact mapping, controlled rising/falling examples, and guided listening test. |
| Hardware delays delivery | Keep controller optional; ship website controls first. |
| Accessibility claim lacks testing | Show keyboard and textual equivalents; describe any actual participant testing honestly. |

## Reference links

- NASA Space Apps 2026 challenge: https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/
- NASA SVS SST visualization / frames: https://svs.gsfc.nasa.gov/5101/
- NASA JPL MUR v4.1 dataset: https://podaac.jpl.nasa.gov/dataset/MUR-JPL-L4-GLOB-v4.1
- NASA SVS API and usage guide: https://svs.gsfc.nasa.gov/help/
- MDN Web Serial API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
- NASA Space Apps 2026 submission information: https://www.spaceappschallenge.org/2026/
