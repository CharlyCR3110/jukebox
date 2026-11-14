import { Map as MLMap, Marker, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre resolves its worker relative to its own module, which bundling breaks; point at it explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { FrameData } from '../data/frames';
import { COASTLINE_TILES, GIBS_ATTRIBUTION } from '../data/gibs';
import type { Probe } from '../sonify/mapping';

interface Props {
  frames: FrameData[] | null;
  frame: number;
  maxZoom: number;
  probe: Probe;
  probeTag: string;
  label: string;
  onProbe: (lat: number, lon: number) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}

setWorkerUrl(workerUrl);

const WORLD: [[number, number], [number, number]] = [[-180, -72], [180, 80]];

const MERC_LAT = 85.0511;

function line(coords: [number, number][], props: Record<string, unknown>) {
  return { type: 'Feature' as const, properties: props, geometry: { type: 'LineString' as const, coordinates: coords } };
}

/** Graticule matching the design: 30° lines, dashed equator. Densified so it bends on the globe. */
function graticule() {
  const features = [];
  for (const lat of [-60, -30, 0, 30, 60]) {
    const pts: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 2) pts.push([lon, lat]);
    features.push(line(pts, { eq: lat === 0 }));
  }
  for (const lon of [-120, -60, 0, 60, 120]) {
    const pts: [number, number][] = [];
    for (let lat = -84; lat <= 84; lat += 2) pts.push([lon, lat]);
    features.push(line(pts, { eq: false }));
  }
  return { type: 'FeatureCollection' as const, features };
}

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      coast: { type: 'raster', tiles: [COASTLINE_TILES], tileSize: 256, maxzoom: 9 },
      grat: { type: 'geojson', data: graticule() },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': '#262B28' } },
      {
        id: 'coast', type: 'raster', source: 'coast',
        paint: { 'raster-opacity': 0.4, 'raster-brightness-min': 0.8, 'raster-fade-duration': 0 },
      },
      {
        id: 'grat', type: 'line', source: 'grat', filter: ['!', ['get', 'eq']],
        paint: { 'line-color': 'rgba(232,233,226,0.10)', 'line-width': 1 },
      },
      {
        id: 'grat-eq', type: 'line', source: 'grat', filter: ['get', 'eq'],
        paint: { 'line-color': 'rgba(232,233,226,0.22)', 'line-width': 1, 'line-dasharray': [3, 3] },
      },
    ],
  };
}

function probeElement() {
  const el = document.createElement('div');
  el.className = 'probe';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="probe-ring"></div><div class="probe-h"></div><div class="probe-v"></div><div class="probe-tag"></div>';
  return el;
}

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

export function MapView({ frames, frame, maxZoom, probe, probeTag, label, onProbe, onKeyDown, children }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onProbeRef = useRef(onProbe);
  onProbeRef.current = onProbe;
  const tileErrors = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [useImages, setUseImages] = useState(() => !navigator.onLine);
  const [globe, setGlobe] = useState(false);

  useEffect(() => {
    const map = new MLMap({
      container: mapEl.current!,
      style: baseStyle(),
      bounds: WORLD,
      renderWorldCopies: false,
      keyboard: false,
      dragRotate: false,
      maxZoom: 9,
      attributionControl: { compact: true, customAttribution: GIBS_ATTRIBUTION },
    });
    map.getCanvas().setAttribute('tabindex', '-1');
    map.on('load', () => setLoaded(true));
    map.on('click', (e) => onProbeRef.current(e.lngLat.lat, wrapLon(e.lngLat.lng)));
    map.on('error', (e) => {
      const src = (e as unknown as { sourceId?: string }).sourceId;
      if (src?.startsWith('sst-') && ++tileErrors.current >= 6) setUseImages(true);
    });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(mapEl.current!);
    return () => {
      ro.disconnect();
      markerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setLoaded(false);
    };
  }, []);

  // (Re)build one raster layer per frame; all stay loaded so frame changes are instant.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const style = map.getStyle();
    style.layers.filter((l) => l.id.startsWith('sst-')).forEach((l) => map.removeLayer(l.id));
    Object.keys(style.sources).filter((s) => s.startsWith('sst-')).forEach((s) => map.removeSource(s));
    if (!frames) return;
    const images = useImages && frames.every((f) => f.image);
    frames.forEach((f, i) => {
      const id = `sst-${i}`;
      if (images) {
        map.addSource(id, {
          type: 'image', url: f.image!,
          coordinates: [[-180, MERC_LAT], [180, MERC_LAT], [180, -MERC_LAT], [-180, -MERC_LAT]],
        });
      } else {
        map.addSource(id, { type: 'raster', tiles: [f.tiles], tileSize: 256, maxzoom: maxZoom });
      }
      map.addLayer(
        { id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
        'coast',
      );
    });
  }, [frames, loaded, useImages, maxZoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !frames) return;
    frames.forEach((_, i) => {
      if (map.getLayer(`sst-${i}`)) map.setPaintProperty(`sst-${i}`, 'raster-opacity', i === frame ? 1 : 0);
    });
  }, [frame, frames, loaded, useImages]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    map.setProjection({ type: globe ? 'globe' : 'mercator' });
    if (globe) map.easeTo({ zoom: 1.7, center: map.getCenter(), duration: 500 });
    else map.fitBounds(WORLD, { duration: 500 });
  }, [globe, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!probe) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = new Marker({ element: probeElement(), anchor: 'center' });
    }
    markerRef.current.setLngLat([probe[1], probe[0]]).addTo(map);
  }, [probe]);

  useEffect(() => {
    const tag = markerRef.current?.getElement().querySelector('.probe-tag');
    if (tag) tag.textContent = probeTag;
  }, [probeTag, probe]);

  return (
    <div className="map-frame">
      <div
        className="map-canvas"
        ref={mapEl}
        role="application"
        tabIndex={0}
        aria-label={label}
        onKeyDown={onKeyDown}
      />
      {children}
      <div className="map-tools">
        <button type="button" className="chip" aria-pressed={globe} onClick={() => setGlobe((g) => !g)}>
          {globe ? 'FLAT MAP' : 'GLOBE'}
        </button>
        <button type="button" className="chip" onClick={() => mapRef.current?.fitBounds(WORLD, { duration: 600 })}>
          RESET VIEW
        </button>
      </div>
    </div>
  );
}
