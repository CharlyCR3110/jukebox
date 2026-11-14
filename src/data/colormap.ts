/**
 * GIBS colormap handling. GIBS publishes, for every layer, the exact RGB used for each
 * value bin. Inverting that table turns a rendered NASA image back into numbers.
 */
export interface ColorEntry {
  r: number;
  g: number;
  b: number;
  /** Representative value of the bin (its midpoint). */
  value: number;
}

export interface Colormap {
  entries: ColorEntry[];
  units: string;
  min: number;
  max: number;
  /** RGB → value. Exact match first, then nearest colour (cached). */
  lookup(r: number, g: number, b: number): number;
}

function parseBin(range: string, step: number): number | null {
  const m = /^[[(]\s*([^,]+)\s*,\s*([^\])]+)\s*[\])]$/.exec(range.trim());
  if (!m) return null;
  const lo = m[1].includes('INF') ? NaN : parseFloat(m[1]);
  const hi = m[2].includes('INF') ? NaN : parseFloat(m[2]);
  if (Number.isNaN(lo) && Number.isNaN(hi)) return null;
  if (Number.isNaN(lo)) return hi - step / 2;
  if (Number.isNaN(hi)) return lo + step / 2;
  return (lo + hi) / 2;
}

export function parseColormap(xml: string): Colormap {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const maps = Array.from(doc.getElementsByTagName('ColorMap'));
  const map = maps.find((m) => m.getAttribute('units')) ?? maps[maps.length - 1];
  if (!map) throw new Error('No ColorMap in GIBS colormap XML');
  const raw = Array.from(map.getElementsByTagName('ColorMapEntry')).filter(
    (e) => e.getAttribute('nodata') !== 'true' && e.getAttribute('transparent') !== 'true',
  );
  const entries: ColorEntry[] = [];
  for (const e of raw) {
    const [r, g, b] = (e.getAttribute('rgb') ?? '').split(',').map(Number);
    const v = parseBin(e.getAttribute('value') ?? '', 0.15);
    if (v !== null && [r, g, b].every(Number.isFinite)) entries.push({ r, g, b, value: v });
  }
  if (!entries.length) throw new Error('Colormap has no usable entries');

  const cache = new Map<number, number>();
  for (const c of entries) cache.set((c.r << 16) | (c.g << 8) | c.b, c.value);

  return {
    entries,
    units: map.getAttribute('units') ?? '',
    min: entries[0].value,
    max: entries[entries.length - 1].value,
    lookup(r, g, b) {
      const key = (r << 16) | (g << 8) | b;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      let best = entries[0].value;
      let bestD = Infinity;
      for (const c of entries) {
        const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
        if (d < bestD) { bestD = d; best = c.value; }
      }
      cache.set(key, best);
      return best;
    },
  };
}

/** CSS gradient for the legend, sampled from the real colormap. */
export function colormapGradient(cm: Colormap, stops = 16): string {
  const n = cm.entries.length;
  const parts: string[] = [];
  for (let i = 0; i < stops; i++) {
    const e = cm.entries[Math.round((i / (stops - 1)) * (n - 1))];
    parts.push(`rgb(${e.r},${e.g},${e.b})`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
