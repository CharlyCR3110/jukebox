#!/usr/bin/env node
/**
 * Caches a year of NASA GIBS frames under public/data/<dataset>/<year>/ so the app
 * works offline (e.g. hackathon demo Wi-Fi). The browser still does the analysis:
 * it decodes these exact images through the cached colormap.
 *
 *   npm run fetch-frames -- 2023
 *   npm run fetch-frames -- 2015 2023
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAYER = 'GHRSST_L4_MUR_Sea_Surface_Temperature';
const COLORMAP = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GHRSST_Sea_Surface_Temperature.xml';
const WMS4326 = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const WMS3857 = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';
const MERC = 20037508.34;

const years = process.argv.slice(2).map(Number).filter((y) => y >= 2003 && y <= 2030);
if (!years.length) years.push(2023);

function wms(base, crs, bbox, w, h, date) {
  const q = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: LAYER, STYLES: '',
    CRS: crs, BBOX: bbox, WIDTH: String(w), HEIGHT: String(h), FORMAT: 'image/png', TIME: date,
  });
  return `${base}?${q}`;
}

async function download(url, file, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (url.includes('wms.cgi') && !type.includes('image/png')) throw new Error(`unexpected ${type}: ${buf.toString('utf8', 0, 200)}`);
      await writeFile(file, buf);
      return buf.length;
    } catch (e) {
      if (i === attempts) throw new Error(`${url} → ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

for (const year of years) {
  const dir = join(ROOT, 'public', 'data', 'ocean', String(year));
  await mkdir(dir, { recursive: true });
  await download(COLORMAP, join(dir, 'colormap.xml'));
  const frames = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    const date = `${year}-${mm}-15`;
    const analysis = `analysis-${mm}.png`;
    const display = `display-${mm}.png`;
    const a = await download(wms(WMS4326, 'EPSG:4326', '-90,-180,90,180', 720, 360, date), join(dir, analysis));
    const d = await download(wms(WMS3857, 'EPSG:3857', `${-MERC},${-MERC},${MERC},${MERC}`, 2048, 2048, date), join(dir, display));
    frames.push({ date, analysis, display });
    console.log(`${date}  analysis ${(a / 1024).toFixed(0)} KB  display ${(d / 1024).toFixed(0)} KB`);
  }
  const manifest = { dataset: 'ocean', layer: LAYER, year, colormap: 'colormap.xml', fetchedAt: new Date().toISOString(), frames };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${join(dir, 'manifest.json')}`);
}
