/** TEST-ONLY synthetic manifest. Never served by the app. */
import type { Manifest, PointObservation } from '../data/manifest';

export function fixtureManifest(series: (number | null)[] = [20, 20.5, 20.5, 19.8, null, 21, 22, 23]): Manifest {
  const locations = [
    { id: 'a', name: 'A', lat: 0, lon: -140 },
    { id: 'b', name: 'B', lat: 45, lon: -35 },
    { id: 'c', name: 'C', lat: -55, lon: 0 },
  ];
  let prev: (number | null) | undefined;
  const frames = series.map((v, i) => {
    const point = (lat: number, lon: number): PointObservation => ({
      lat, lon, sstC: v, isValid: v !== null, spatialStdC: null,
      deltaC: i > 0 && v !== null && prev !== null && prev !== undefined ? +(v - prev).toFixed(3) : null,
    });
    const f = {
      frameId: `f${i}`, date: `2026-${String(i + 1).padStart(2, '0')}-15`, imageUrl: `x${i}.jpg`, sourceUrl: `https://example.test/${i}`,
      datasetId: 'MUR-JPL-L4-GLOB-v4.1', daysSincePrevious: i ? 30 : null,
      points: Object.fromEntries(locations.map((l) => [l.id, point(l.lat, l.lon)])),
    };
    prev = v;
    return f;
  });
  return {
    schemaVersion: 1, title: 'T', datasetId: 'MUR-JPL-L4-GLOB-v4.1', dataMode: 'measured_sst', units: 'degC',
    samplingMethod: 'test', generatedAt: '2026-11-14T00:00:00Z', generator: 'test',
    visualization: { svsId: 5101, title: 't', url: 'u', eicKeyword: true, frameSet: 'u', projection: 'p', credit: 'c' },
    numericSource: null, colorScale: null, locations, frames,
  };
}
