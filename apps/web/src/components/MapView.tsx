import { Map as MLMap, Marker, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre resolves its worker relative to its own module, which bundling breaks; point at it explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { assetUrl, type FrameObservation, type Location } from '../data/manifest';

setWorkerUrl(workerUrl);

const MERC_LAT = 85.0511;
const WORLD: [[number, number], [number, number]] = [[-180, -72], [180, 80]];
/** Clicks farther than this from every preset location select nothing. */
const SNAP_KM = 2500;

interface Props {
  frames: FrameObservation[];
  frameIndex: number;
  locations: Location[];
  locationId: string;
  label: string;
  onSelect: (id: string) => void;
  onMiss: () => void;
  children?: ReactNode;
}

function graticule() {
  const line = (coordinates: [number, number][], eq: boolean) => ({
    type: 'Feature' as const, properties: { eq }, geometry: { type: 'LineString' as const, coordinates },
  });
  const features = [];
  for (const lat of [-60, -30, 0, 30, 60]) {
    features.push(line(Array.from({ length: 181 }, (_, i) => [-180 + i * 2, lat] as [number, number]), lat === 0));
  }
  for (const lon of [-120, -60, 0, 60, 120]) {
    features.push(line(Array.from({ length: 85 }, (_, i) => [lon, -84 + i * 2] as [number, number]), false));
  }
  return { type: 'FeatureCollection' as const, features };
}

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: { grat: { type: 'geojson', data: graticule() } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#1C211F' } },
      { id: 'grat', type: 'line', source: 'grat', filter: ['!', ['get', 'eq']], paint: { 'line-color': 'rgba(232,233,226,0.12)', 'line-width': 1 } },
      { id: 'grat-eq', type: 'line', source: 'grat', filter: ['get', 'eq'], paint: { 'line-color': 'rgba(232,233,226,0.28)', 'line-width': 1, 'line-dasharray': [3, 3] } },
    ],
  };
}

export function haversineKm(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function markerEl(name: string, lon: number) {
  const el = document.createElement('div');
  el.className = lon > 100 ? 'loc flip' : 'loc';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="loc-ring"></div><div class="loc-dot"></div><div class="loc-tag"></div>';
  el.querySelector('.loc-tag')!.textContent = name;
  return el;
}

export function MapView({ frames, frameIndex, locations, locationId, label, onSelect, onMiss, children }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const cb = useRef({ onSelect, onMiss, locations });
  cb.current = { onSelect, onMiss, locations };
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const map = new MLMap({
      container: el.current!,
      style: baseStyle(),
      bounds: WORLD,
      renderWorldCopies: false,
      keyboard: false,
      dragRotate: false,
      maxZoom: 6,
      attributionControl: { compact: true, customAttribution: "Visualization: NASA's Scientific Visualization Studio" },
    });
    map.getCanvas().setAttribute('tabindex', '-1');
    map.on('load', () => setLoaded(true));
    map.on('click', (e) => {
      const at: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      let best: Location | null = null, bestKm = Infinity;
      for (const l of cb.current.locations) {
        const d = haversineKm(at, [l.lat, l.lon]);
        if (d < bestKm) { bestKm = d; best = l; }
      }
      if (best && bestKm <= SNAP_KM) cb.current.onSelect(best.id);
      else cb.current.onMiss();
    });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current!);
    const ms = markers.current;
    return () => {
      ro.disconnect();
      ms.forEach((m) => m.remove());
      ms.clear();
      map.remove();
      mapRef.current = null;
      setLoaded(false);
    };
  }, []);

  // One image layer per observation, all loaded up front so frame changes are instant.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    frames.forEach((f, i) => {
      const id = `frame-${i}`;
      if (map.getSource(id)) return;
      map.addSource(id, {
        type: 'image',
        url: assetUrl(f.imageUrl),
        coordinates: [[-180, MERC_LAT], [180, MERC_LAT], [180, -MERC_LAT], [-180, -MERC_LAT]],
      });
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } }, 'grat');
    });
  }, [frames, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    frames.forEach((_, i) => map.getLayer(`frame-${i}`) && map.setPaintProperty(`frame-${i}`, 'raster-opacity', i === frameIndex ? 1 : 0));
  }, [frameIndex, frames, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const l of locations) {
      if (!markers.current.has(l.id)) {
        markers.current.set(l.id, new Marker({ element: markerEl(l.name, l.lon), anchor: 'center' }).setLngLat([l.lon, l.lat]).addTo(map));
      }
    }
  }, [locations]);

  useEffect(() => {
    markers.current.forEach((m, id) => m.getElement().classList.toggle('on', id === locationId));
  }, [locationId, locations]);

  return (
    <div className="map-frame">
      <div className="map-canvas" ref={el} role="img" aria-label={label} />
      {children}
      <div className="map-tools">
        <button type="button" className="chip" onClick={() => mapRef.current?.fitBounds(WORLD, { duration: 500 })}>RESET VIEW</button>
      </div>
    </div>
  );
}
