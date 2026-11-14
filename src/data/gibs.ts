/** URL builders for NASA GIBS (Global Imagery Browse Services). CORS-enabled, no key. */
const GIBS = 'https://gibs.earthdata.nasa.gov';

/** Analysis frame size: equirectangular, 0.5° per pixel. */
export const ANALYSIS_W = 720;
export const ANALYSIS_H = 360;

export function wmtsTileUrl(layer: string, date: string, tileMatrixSet: string): string {
  return `${GIBS}/wmts/epsg3857/best/${layer}/default/${date}/${tileMatrixSet}/{z}/{y}/{x}.png`;
}

/** Whole-globe equirectangular frame (EPSG:4326), used for pixel analysis. */
export function wmsFrameUrl(layer: string, date: string, w = ANALYSIS_W, h = ANALYSIS_H): string {
  const q = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: layer, STYLES: '',
    CRS: 'EPSG:4326', BBOX: '-90,-180,90,180', WIDTH: String(w), HEIGHT: String(h),
    FORMAT: 'image/png', TIME: date,
  });
  return `${GIBS}/wms/epsg4326/best/wms.cgi?${q}`;
}

export const COASTLINE_TILES = `${GIBS}/wmts/epsg3857/best/Coastlines_15m/default/2023-01-01/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`;

export const GIBS_ATTRIBUTION =
  'Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA GIBS</a> · Data: JPL MUR SST, PO.DAAC';
