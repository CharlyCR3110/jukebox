/**
 * Data contract (spec §6). Produced by scripts/prepare_data.py, consumed read-only by the app.
 * Every number shown in the UI comes from one of these objects.
 */
export type DataMode = 'measured_sst' | 'visual_feature';

export interface PointObservation {
  lat: number;
  lon: number;
  /** Measured sea-surface temperature, °C. null when invalid or in visual_feature mode. */
  sstC: number | null;
  /** sstC(t) − sstC(previous selected observation), °C. null unless both are valid. */
  deltaC: number | null;
  isValid: boolean;
  spatialStdC?: number | null;
  coverage?: number;
  nCells?: number;
  /** visual_feature mode only: red–blue index of frame pixels, −1…1. Not a temperature. */
  feature?: number | null;
  featureDelta?: number | null;
}

export interface FrameObservation {
  frameId: string;
  date: string;
  imageUrl: string;
  sourceUrl: string;
  datasetId: string;
  daysSincePrevious: number | null;
  numericSourceUrl?: string;
  points: Record<string, PointObservation>;
}

export interface Location {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface Manifest {
  schemaVersion: 1;
  title: string;
  datasetId: string;
  dataMode: DataMode;
  units: 'degC' | 'red_blue_index';
  samplingMethod: string;
  generatedAt: string;
  generator: string;
  visualization: {
    svsId: number;
    title: string;
    url: string;
    eicKeyword: boolean;
    frameSet: string;
    projection: string;
    credit: string;
  };
  numericSource: null | { name: string; shortName: string; url: string; doi: string; credit: string; variable: string };
  colorScale: null | { minC: number; maxC: number; stops: string[]; source: string };
  locations: Location[];
  frames: FrameObservation[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown) => v === null || isNum(v);

/** Returns a list of contract violations; empty means the manifest is usable. */
export function validateManifest(m: unknown): string[] {
  const errs: string[] = [];
  const x = m as Partial<Manifest>;
  if (!x || typeof x !== 'object') return ['manifest is not an object'];
  if (x.schemaVersion !== 1) errs.push('schemaVersion must be 1');
  if (x.dataMode !== 'measured_sst' && x.dataMode !== 'visual_feature') errs.push('dataMode must be measured_sst or visual_feature');
  if (!x.samplingMethod) errs.push('samplingMethod is required');
  if (!Array.isArray(x.locations) || x.locations.length < 3) errs.push('at least 3 locations are required');
  if (!Array.isArray(x.frames) || x.frames.length < 8 || x.frames.length > 24) errs.push('8–24 frames are required');
  if (errs.length) return errs;

  const ids = new Set(x.locations!.map((l) => l.id));
  let prevDate = '';
  x.frames!.forEach((f, i) => {
    const at = `frames[${i}]`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) errs.push(`${at}.date must be YYYY-MM-DD`);
    if (f.date <= prevDate) errs.push(`${at}.date must be after the previous frame`);
    prevDate = f.date;
    if (!f.imageUrl || !f.sourceUrl) errs.push(`${at} needs imageUrl and sourceUrl`);
    for (const id of ids) {
      const p = f.points?.[id];
      if (!p) { errs.push(`${at}.points.${id} missing`); continue; }
      if (!isNum(p.lat) || !isNum(p.lon)) errs.push(`${at}.points.${id} lat/lon`);
      if (!isNumOrNull(p.sstC) || !isNumOrNull(p.deltaC)) errs.push(`${at}.points.${id} sstC/deltaC must be number or null`);
      if (x.dataMode === 'measured_sst') {
        if (p.isValid && p.sstC === null) errs.push(`${at}.points.${id} valid but sstC is null`);
        if (!p.isValid && p.sstC !== null) errs.push(`${at}.points.${id} invalid but has sstC`);
        if (i === 0 && p.deltaC !== null) errs.push(`${at}.points.${id} first frame cannot have deltaC`);
      } else if (p.sstC !== null) {
        errs.push(`${at}.points.${id} visual_feature mode must not carry sstC`);
      }
    }
  });
  return errs;
}

export async function loadManifest(url = `${import.meta.env.BASE_URL}data/sst/manifest.json`): Promise<Manifest> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}. Run scripts/prepare_data.py first.`);
  const m = (await res.json()) as Manifest;
  const errs = validateManifest(m);
  if (errs.length) throw new Error(`manifest.json failed validation: ${errs.slice(0, 3).join('; ')}`);
  return m;
}

export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
