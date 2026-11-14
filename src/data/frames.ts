/**
 * Frame pipeline: NASA image → pixels → values.
 *  1. Fetch an equirectangular (EPSG:4326) PNG frame from GIBS, or the local cache
 *     written by `npm run fetch-frames`.
 *  2. Draw it into a canvas and read the RGBA pixels.
 *  3. Map each pixel back to a physical value through the GIBS colormap.
 *  4. Reduce the grid to the statistics the sonification needs.
 */
import { parseColormap, type Colormap } from './colormap';
import { frameDates, MONTHS, type DatasetDef } from './datasets';
import { wmsFrameUrl, wmtsTileUrl } from './gibs';

export interface Grid {
  w: number;
  h: number;
  /** Row-major, row 0 = 90°N, col 0 = 180°W. NaN = land / no data. */
  values: Float32Array;
}

export interface FrameData {
  index: number;
  date: string;
  m: string;
  long: string;
  /** Live GIBS WMTS tile template (zoomable). */
  tiles: string;
  /** Cached whole-globe EPSG:3857 image, used when tiles are unreachable. */
  image?: string;
  grid: Grid;
  /** Area-weighted (cos lat) ocean mean, °C. */
  mean: number;
  /** Area-weighted spatial standard deviation, °C. */
  std: number;
  /** Mean of each 5° latitude band, index 0 = 90–85°N. NaN where no ocean. */
  bands: number[];
}

export interface FrameSet {
  frames: FrameData[];
  colormap: Colormap;
  source: 'cache' | 'live';
}

interface Manifest {
  frames: { date: string; analysis: string; display?: string }[];
  colormap: string;
}

const BASE = import.meta.env.BASE_URL;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

export function decodeImage(img: HTMLImageElement, cm: Colormap): Grid {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const values = new Float32Array(w * h);
  for (let i = 0, p = 0; i < values.length; i++, p += 4) {
    values[i] = px[p + 3] < 200 ? NaN : cm.lookup(px[p], px[p + 1], px[p + 2]);
  }
  return { w, h, values };
}

export function cellOf(grid: Grid, lat: number, lon: number): { r: number; c: number } {
  const r = Math.min(grid.h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * grid.h)));
  let c = Math.floor(((lon + 180) / 360) * grid.w) % grid.w;
  if (c < 0) c += grid.w;
  return { r, c };
}

export function sample(grid: Grid, lat: number, lon: number): number {
  const { r, c } = cellOf(grid, lat, lon);
  return grid.values[r * grid.w + c];
}

/** Values within ±radiusDeg of a point (longitude wraps). */
export function neighbourhood(grid: Grid, lat: number, lon: number, radiusDeg: number): number[] {
  const { r, c } = cellOf(grid, lat, lon);
  const dr = Math.max(1, Math.round((radiusDeg / 180) * grid.h));
  const dc = Math.max(1, Math.round((radiusDeg / 360) * grid.w));
  const out: number[] = [];
  for (let rr = r - dr; rr <= r + dr; rr++) {
    if (rr < 0 || rr >= grid.h) continue;
    for (let k = -dc; k <= dc; k++) {
      const cc = (((c + k) % grid.w) + grid.w) % grid.w;
      const v = grid.values[rr * grid.w + cc];
      if (!Number.isNaN(v)) out.push(v);
    }
  }
  return out;
}

function frameStats(grid: Grid) {
  let sw = 0, sv = 0, sv2 = 0;
  const bandW = new Array(36).fill(0);
  const bandV = new Array(36).fill(0);
  for (let r = 0; r < grid.h; r++) {
    const lat = 90 - ((r + 0.5) / grid.h) * 180;
    const wgt = Math.cos((lat * Math.PI) / 180);
    const band = Math.min(35, Math.floor(((90 - lat) / 180) * 36));
    for (let c = 0; c < grid.w; c++) {
      const v = grid.values[r * grid.w + c];
      if (Number.isNaN(v)) continue;
      sw += wgt; sv += wgt * v; sv2 += wgt * v * v;
      bandW[band] += wgt; bandV[band] += wgt * v;
    }
  }
  const mean = sv / sw;
  const std = Math.sqrt(Math.max(0, sv2 / sw - mean * mean));
  const bands = bandV.map((v, i) => (bandW[i] ? v / bandW[i] : NaN));
  return { mean, std, bands };
}

async function tryManifest(dataset: DatasetDef, year: number): Promise<{ dir: string; m: Manifest } | null> {
  const dir = `${BASE}data/${dataset.id}/${year}/`;
  try {
    const res = await fetch(`${dir}manifest.json`, { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const m = (await res.json()) as Manifest;
    return m.frames?.length === 12 ? { dir, m } : null;
  } catch {
    return null;
  }
}

export async function loadFrameSet(
  dataset: DatasetDef,
  year: number,
  onProgress: (done: number) => void,
  isCancelled: () => boolean,
): Promise<FrameSet> {
  if (!dataset.layer || !dataset.colormap || !dataset.tileMatrixSet) throw new Error(`${dataset.name} is not configured`);
  const dates = frameDates(year);
  const cached = await tryManifest(dataset, year);

  const cmUrl = cached ? cached.dir + cached.m.colormap : dataset.colormap;
  const cmRes = await fetch(cmUrl);
  if (!cmRes.ok) throw new Error(`Colormap request failed (${cmRes.status})`);
  const colormap = parseColormap(await cmRes.text());

  let done = 0;
  const frames = await Promise.all(
    dates.map(async (date, i) => {
      const local = cached?.m.frames.find((f) => f.date === date);
      let img: HTMLImageElement;
      try {
        img = await loadImage(local ? cached!.dir + local.analysis : wmsFrameUrl(dataset.layer!, date));
      } catch (e) {
        if (!local) throw e;
        img = await loadImage(wmsFrameUrl(dataset.layer!, date));
      }
      if (isCancelled()) throw new Error('cancelled');
      const grid = decodeImage(img, colormap);
      const stats = frameStats(grid);
      onProgress(++done);
      const frame: FrameData = {
        index: i,
        date,
        m: MONTHS[i][0],
        long: MONTHS[i][1],
        tiles: wmtsTileUrl(dataset.layer!, date, dataset.tileMatrixSet!),
        image: local?.display ? cached!.dir + local.display : undefined,
        grid,
        ...stats,
      };
      return frame;
    }),
  );
  return { frames, colormap, source: cached ? 'cache' : 'live' };
}
