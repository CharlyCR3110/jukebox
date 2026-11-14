# Demo runbook

## Before the demo (second laptop, desktop Chrome or Edge)

```bash
git clone <repo> && cd jukebox
npm run setup            # installs apps/web dependencies
npm run build            # type-check + unit tests + production bundle
npm run preview          # http://127.0.0.1:4173, loopback only
```

All frames and the manifest are in `apps/web/public/data/sst/`, so the demo works **offline** once dependencies
are installed. Fonts fall back to system fonts without network access.

Check before going on stage:
- [ ] Header shows `MUR SST v4.1 · NASA SVS 5101 · EIC` and no VISUAL FEATURE MODE banner (shipped data is measured).
- [ ] Laptop volume about 50 %; app volume 40 % (default).
- [ ] Press Play once: tones audible. Press Pause: silent.
- [ ] Controller (optional): click **CONTROLLER · CONNECT**, pick the ESP32 port, turn the knob, and watch the timeline move.

## 90-second script

| Time | Action | Say |
|---|---|---|
| 0–15 s | Point to the map, badge and date | “Most Earth science is shown through images. This is NASA’s Earth Information Center sea-surface temperature visualization, November 2025.” |
| 15–35 s | Select **Western Pacific warm pool**, press **Play** | “Warmer water, higher tone. Read the value on screen: 30.14 °C on the first frame, so 220 + 30.14/35 × 660 ≈ 788 Hz. The formula is shown in the panel.” |
| 35–55 s | Switch to **North Atlantic** while playing | “Hear the pitch climb through spring and summer. Each upward glide means warmer than last month, and more pulses mean a bigger change.” |
| 55–70 s | Close your eyes / hide the screen, switch to **Southern Ocean** | “Without looking: low and steady. Cold, and changing slowly.” |
| 70–90 s | Turn the ESP32 knob, Tab to the location list, open “What am I hearing?” | “Same controls by knob, keyboard, or mouse, plus a text equivalent for every sound. Every number links back to its NASA source file.” |

In visual-feature mode, replace temperature lines with “redder pixels, higher tone” and say plainly that it
describes the image, not a measurement.

## Fallbacks

| Problem | Do |
|---|---|
| No audio | Header shows NO AUDIO. Use the “In words” line and readout; reload and press Play again (needs a click). |
| Controller fails | Unplug it; on-screen and keyboard controls are identical (Space, ←/→, ↑/↓, M). |
| Laptop dies | Second laptop runs `npm run preview` from the same repo. |
| Map does not render (WebGL off) | Readout, timeline, sound and text still work; enable hardware acceleration. |

## Acceptance tests (spec §11) and how to check them

| # | Test | How |
|---|---|---|
| 1 | NASA frame and correct date | Badge, card and timeline date match the frame file name (`sourceUrl`). |
| 2 | Location without the map | Tab to *Listening location* and choose one; the readout updates. |
| 3 | Same index everywhere | During playback, card, readout, timeline and “In words” show the same date. Automated check in the browser run. |
| 4 | Predictable pitch | `npm test`: 24.0 °C → 673 Hz; warmer gives higher. |
| 5 | Rising/falling/unchanged/missing | `npm test`, `mapping.test.ts`. |
| 6 | Pause/mute, no autoplay | No sound until Play; Pause silent within about 80 ms (measured). |
| 7 | Keyboard parity | Space, arrows, M; Tab reaches every control. |
| 8 | Works without controller | Reload without the device; disconnecting it leaves playback running. |
| 9 | Provenance | “What am I hearing?” lists source, sampling method, units; manifest stores per-frame URLs. |
| 10 | Second machine | Follow this runbook on another laptop. |
