# Earth Jukebox — Listening Lab

NASA Space Apps 2026 · [The Earth Information Jukebox](https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/)

Turns NASA's ocean-temperature imagery into sound. Pick a year and a listening point, then press play. Each month is
one frame: its pitch, rhythm and texture come from the colours in NASA's own map images.

```bash
npm install
npm run dev            # http://127.0.0.1:5173 (bound to loopback only)
npm run build          # type-check + production bundle in dist/
npm run fetch-frames -- 2023 2015   # cache years for offline demos
```

## How it works

```
NASA GIBS image (PNG, EPSG:4326, 0.5°/px)
  └─ canvas getImageData ─ RGB → °C via the GIBS colormap XML (215 bins, 0.15 °C)
       └─ grid stats: cos(lat)-weighted ocean mean, spatial σ, 5° latitude bands
            └─ mapping (src/sonify/mapping.ts)
                 anomaly vs 12-month mean → pitch (C major pentatonic, ±span octaves)
                 change since last frame  → LFO pulse rate (0.5–8 Hz)
                 spatial spread           → band-passed noise "grain"
                 └─ Tone.js graph (src/sonify/engine.ts) → live audio or offline WAV
```

- **Map**: MapLibre GL JS 6 with NASA GIBS WMTS tiles (`GHRSST_L4_MUR_Sea_Surface_Temperature`, one layer per month
  so frame changes are instant), GIBS coastlines, a 30° graticule, and a flat/globe toggle. Click (or use the arrow keys)
  to drop a probe; Esc returns to the global mean.
- **Audio**: Tone.js. A triangle drone, LFO-gated for rhythm, plus noise for texture and an FM bell struck on each new month.
  Frame stepping runs on `Tone.Transport`, so sound and visuals stay in sync. **Download 12-frame WAV** renders the
  same graph with `Tone.Offline`.
- **Accessibility**: every control is keyboard reachable. The "In words" line is an `aria-live` text description of
  what you hear, and a status line reports audio state.

## Data sources

| What | Where |
|---|---|
| Sea-surface temperature | JPL MUR SST, GHRSST L4 v4.1 (PO.DAAC), daily, 0.01°. Frames use the 15th of each month |
| Imagery + colormap | NASA GIBS: `gibs.earthdata.nasa.gov` WMTS/WMS, `colormaps/v1.3/GHRSST_Sea_Surface_Temperature.xml` |

Values are decoded from rendered imagery, so they are quantised to the 0.15 °C colormap bins, and land/sea ice shows up
as "no data". That is accurate enough for sonification but not for science.

### Offline / demo mode

`npm run fetch-frames -- <year…>` saves `public/data/ocean/<year>/` (analysis PNGs, 2048² display PNGs, colormap,
`manifest.json`). When a manifest exists the app analyses the local files. If GIBS tiles fail to load, the map switches
to the cached display images. 2023 is pre-cached (about 13 MB).

## Layout

```
src/data/       datasets.ts (registry), gibs.ts (URLs), colormap.ts, frames.ts (decode + stats), useFrames.ts
src/sonify/     mapping.ts (data→sound rules, text description), engine.ts (Tone.js live + offline WAV)
src/components/ MapView (MapLibre), Timeline, SonificationPanel, Chrome (header, dataset bar, footer)
scripts/        fetch-nasa-frames.mjs
```

To add a dataset (vegetation, sea ice…), add a GIBS layer and its colormap to `src/data/datasets.ts` and set `ready: true`.
The mapping currently assumes temperature-like units.
