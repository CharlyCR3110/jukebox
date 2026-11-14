# Methodology: data source, transforms, audio mapping

Everything here is produced by `scripts/prepare_data.py` and implemented in
`apps/web/src/audio/mapping.ts`. Unit tests (`npm test`) pin the formulas below.

## 1. Sources

| Role | Source | Access |
|---|---|---|
| Visual frames | NASA SVS **5101** “Sea Surface Temperature (SST) - Near Real Time”, frame set `sst_mur_no-dates`, 4096×2048 equirectangular EXR, one file per day (`sst_mur_YYYYMMDD_no-dates.exr`), currently 2024-05-27 … 2026-11-13 | Public HTTPS |
| Measured values | GHRSST L4 **MUR v4.1** (`MUR-JPL-L4-GLOB-v4.1`), NASA JPL / PO.DAAC, daily 0.01°, variable `analysed_sst` (K), DOI 10.5067/GHGMR-4FJ04 | Earthdata Login (free) |
| Extraction self-test | Same MUR v4.1 product mirrored on AWS Open Data (`s3://mur-sst/zarr-v1`), 2002-06 … ~2020-01 | Anonymous |

**EIC provenance (confirmed 2026-11-14):** SVS 5101 is listed in the **Earth Information Center (EIC) Content
Database**, the SVS gallery the challenge names as its data resource
(https://svs.gsfc.nasa.gov/gallery/earth-information-center/, SVS API id 40467), under the sub-gallery
*Daily Visualizations* (https://svs.gsfc.nasa.gov/gallery/daily-visualizations/, id 40512). Its SVS API record also
carries the keyword “Earth Information Center”, which the pipeline stores in `manifest.visualization.eicKeyword`.
To re-check: fetch `https://svs.gsfc.nasa.gov/api/40467`, follow its gallery items and look for id 5101.

## 2. Observation dates

Default: the 15th of each month, 2025-11-15 … 2026-10-15 (12 observations). Intervals are 28–31 days and the
app shows the exact count (`daysSincePrevious`). Each SVS frame and each MUR granule is named for the same
calendar date (MUR nominal time 09:00 UTC). The script refuses to run if any requested date has no SVS frame,
and never interpolates.

## 3. Numeric extraction (`--mode measured`)

For each location and date:

1. Open the MUR granule for that date (via `earthaccess`; only the chunks covering the box are read).
2. Box = ±0.05° latitude/longitude around the location (≤ 11 × 11 cells, about 11 km).
3. Valid cells: finite `analysed_sst` **and** `mask == 1` (open sea). Land (2), lake (5) and ice-flagged (9, 13)
   cells are excluded. Fill values are never treated as zero.
4. Valid point if ≥ 50 % of the box is valid. Then `sstC = mean(K) − 273.15` (xarray applies the variable's
   `scale_factor = 0.001` and `add_offset = 298.15`) and `spatialStdC = std`. Otherwise `sstC = null`.
5. `deltaC = sstC(t) − sstC(previous selected observation)` only when both are valid. The first observation has
   no `deltaC`. This is “change since previous selected observation”, **not** a climate anomaly.

Self-test on 2019-11-15 (AWS copy, `--selftest 2019-11-15`): warm pool 29.742 °C, Niño 3.4 26.555 °C,
Gulf of Mexico 25.946 °C, North Atlantic 17.105 °C, Southern Ocean −0.862 °C. A land point (40°N 100°W)
is marked invalid. These numbers only check the extraction code; they are not shown in the app.

## 4. Frames for display

EXR (linear RGB, 0–1) → sRGB 8-bit → exact row remap from plate carrée to Web Mercator (±85.0511°) → 2048² JPEG
(about 300 KB). MapLibre places each image on the full Mercator extent, so a click's coordinates match the image.
The legend colours are sampled from the SVS colorbar (−5 … 35 °C).

## 5. Fallback (`--mode visual`, no credentials)

`feature = mean((R − B) / 255)` over coloured (non-grey) pixels of the sRGB frame within ±0.5°. It is a property
of the visualization only. The app shows a persistent “VISUAL FEATURE MODE · not temperature” banner, uses
the word “index” instead of °C, and the validator rejects any `sstC` in this mode.

## 6. Sound mapping (spec §7)

| Data | Sound | Formula / rule |
|---|---|---|
| SST | Pitch | `Hz = 220 + clamp(°C, 0, 35) / 35 × 660`. Outside 0–35 °C the value is clamped and the UI shows CLAMPED. |
| Sign of ΔC | Onset | Rising: 3-semitone upward glide over 120 ms. Falling: downward glide. \|ΔC\| < 0.05 °C: steady onset. ΔC null: no glide. |
| \|ΔC\| | Pulses per observation | `1 + round(min(|ΔC|, 2) / 2 × 4)`: 0 °C → 1, 0.5 → 2, 1.0 → 3, 1.5 → 4, ≥ 2 → 5 (capped, flagged) |
| Missing / invalid | Silence | Plus “no valid data” text. |
| (visual mode) index −1…1 | Pitch | `Hz = 220 + (index + 1) / 2 × 660`; pulses use \|Δindex\| up to 0.2 |
| Location (identity only) | Instrument / timbre | Warm pool → soft mallet · Niño 3.4 → wooden pluck · Gulf of Mexico → brass · North Atlantic → glass bell · Southern Ocean → breathy wind. **A design choice, not data.** It changes tone colour only; pitch, glide and pulses follow the same rules for every voice. Switch it off (“Zone instruments”) for one uniform tone. |

Worked example: SST 24.0 °C → 220 + 24/35 × 660 = **672.6 Hz** (shown as 673 Hz). ΔC = +0.40 °C → upward glide,
`1 + round(0.4/2 × 4) = 2` pulses.

Zone instruments were checked in the browser on the real audio output. The fundamental of every voice matched the
mapped frequency (330/660/440 Hz test notes, within the estimator's ±1-sample resolution). Rising and falling glides
are audible on every voice. Levels are matched to within ~1 dB of the uniform tone via `trimDb` in `voices.ts`.

Timing: one observation per 1.0 s at 1×, 0.5 s at 2×. Pulses describe change *between the shown observations*,
not change per second.

Audio chain: zone instrument (or the uniform triangle synth) → per-voice gain → gate → volume → limiter
(−3 dB) → output. Audio starts only after a user gesture (Play, Space or Connect controller). Pause closes the
gate on the immediate audio clock and discards queued notes. Measured: silent within about 80 ms of pressing Pause,
including the analyser's 23 ms buffer. Mute and volume are remembered in `localStorage`.

## 7. Limitations

- Sound mapping choices (ranges, glide size, pulse cap) are design decisions and have not been tested with listeners yet.
- Monthly snapshots from single days are weather-influenced; one day does not represent a monthly mean.
- Spatial variability (`spatialStdC`) is exported but **not** sonified (spec P1, interpretation untested).
