/**
 * Dataset registry. Each sonifiable dataset is a NASA GIBS imagery layer plus the
 * GIBS colormap that lets us turn its pixels back into physical values.
 * Adding a dataset = adding an entry here (and flipping `ready`).
 */
export interface DatasetDef {
  id: string;
  name: string;
  ready: boolean;
  category?: string;
  title?: string;
  /** GIBS layer identifier (same id for WMTS tiles and WMS frames). */
  layer?: string;
  /** GIBS WMTS tile matrix set for EPSG:3857. */
  tileMatrixSet?: string;
  maxZoom?: number;
  /** GIBS colormap XML used to invert pixel colours into values. */
  colormap?: string;
  units?: string;
  shortUnits?: string;
  minYear?: number;
  maxYear?: number;
  sourceNote?: string;
}

export const DATASETS: DatasetDef[] = [
  {
    id: 'ocean',
    name: 'Ocean Temperature',
    ready: true,
    category: 'OCEAN / CLIMATE',
    title: 'Ocean Surface Temperature',
    layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
    tileMatrixSet: 'GoogleMapsCompatible_Level7',
    maxZoom: 7,
    colormap: 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GHRSST_Sea_Surface_Temperature.xml',
    units: '°C',
    shortUnits: 'SST °C',
    minYear: 2003,
    maxYear: 2025,
    sourceNote:
      'NASA JPL MUR SST (GHRSST Level 4, PO.DAAC), served as imagery by NASA GIBS. Values are decoded from the image pixels through the GIBS colormap (0.15 °C bins).',
  },
  { id: 'atmos', name: 'Atmospheric Motion', ready: false },
  { id: 'veg', name: 'Vegetation Change', ready: false },
  { id: 'ice', name: 'Ice Coverage', ready: false },
];

export const OCEAN = DATASETS[0];
export const DEFAULT_YEAR = 2023;

export const MONTHS = [
  ['JAN', 'JANUARY'], ['FEB', 'FEBRUARY'], ['MAR', 'MARCH'], ['APR', 'APRIL'],
  ['MAY', 'MAY'], ['JUN', 'JUNE'], ['JUL', 'JULY'], ['AUG', 'AUGUST'],
  ['SEP', 'SEPTEMBER'], ['OCT', 'OCTOBER'], ['NOV', 'NOVEMBER'], ['DEC', 'DECEMBER'],
] as const;

export const FRAME_COUNT = 12;

/** One frame per month: the daily MUR analysis on the 15th. */
export function frameDates(year: number): string[] {
  return MONTHS.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}-15`);
}

/** Named listening points [lat, lon]. */
export const POINTS: Record<string, { label: string; at: [number, number] }> = {
  wpwp: { label: 'Western Pacific warm pool · 5°N 150°E', at: [5, 150] },
  etp: { label: 'Eastern equatorial Pacific · 2°S 100°W', at: [-2, -100] },
  natl: { label: 'North Atlantic · 45°N 35°W', at: [45, -35] },
  so: { label: 'Southern Ocean · 55°S 0°', at: [-55, 0] },
};
