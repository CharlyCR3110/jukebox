import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest';
import { fixtureManifest } from '../test/fixtures';

describe('validateManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateManifest(fixtureManifest())).toEqual([]);
  });
  it('rejects too few frames', () => {
    expect(validateManifest(fixtureManifest([20, 21, 22]))).toContain('8–24 frames are required');
  });
  it('rejects a valid point without a value, or an invalid point with one', () => {
    const m = fixtureManifest();
    m.frames[2].points.a.sstC = null;
    m.frames[3].points.b.isValid = false;
    const errs = validateManifest(m).join('\n');
    expect(errs).toMatch(/frames\[2\]\.points\.a valid but sstC is null/);
    expect(errs).toMatch(/frames\[3\]\.points\.b invalid but has sstC/);
  });
  it('rejects deltaC on the first frame and out-of-order dates', () => {
    const m = fixtureManifest();
    m.frames[0].points.a.deltaC = 0.1;
    m.frames[5].date = '2026-01-01';
    const errs = validateManifest(m).join('\n');
    expect(errs).toMatch(/first frame cannot have deltaC/);
    expect(errs).toMatch(/frames\[5\]\.date must be after/);
  });
  it('forbids temperatures in visual_feature mode', () => {
    const m = fixtureManifest();
    m.dataMode = 'visual_feature';
    expect(validateManifest(m).join('\n')).toMatch(/visual_feature mode must not carry sstC/);
  });
  it('the shipped manifest passes validation', () => {
    const shipped = import.meta.glob('../../public/data/sst/manifest.json', { eager: true, import: 'default' });
    const m = Object.values(shipped)[0];
    expect(m, 'run scripts/prepare_data.py to create the manifest').toBeDefined();
    expect(validateManifest(m)).toEqual([]);
  });
});
