import { describe, expect, it } from 'vitest';
import { frameInterval, initialState, reducer, type AppState, type Intent } from './store';

const ready = (): AppState => reducer(initialState(), { type: 'INIT', frameCount: 12, locationIds: ['a', 'b', 'c'] });
const run = (s: AppState, ...xs: Intent[]) => xs.reduce(reducer, s);

describe('reducer', () => {
  it('initialises frame and location from the manifest', () => {
    const s = ready();
    expect(s.frameIndex).toBe(0);
    expect(s.locationId).toBe('a');
    expect(s.playing).toBe(false);
  });
  it('does not play before data exists', () => {
    expect(reducer(initialState(), { type: 'PLAY' }).playing).toBe(false);
  });
  it('steps and wraps frames', () => {
    expect(run(ready(), { type: 'PREV_FRAME' }).frameIndex).toBe(11);
    expect(run(ready(), { type: 'NEXT_FRAME' }, { type: 'NEXT_FRAME' }).frameIndex).toBe(2);
  });
  it('clamps SET_FRAME and rejects non-integers', () => {
    expect(run(ready(), { type: 'SET_FRAME', index: 99 }).frameIndex).toBe(11);
    expect(run(ready(), { type: 'SET_FRAME', index: 1.5 }).frameIndex).toBe(0);
  });
  it('selects and cycles locations, ignoring unknown ids', () => {
    expect(run(ready(), { type: 'SELECT_LOCATION', id: 'zzz' }).locationId).toBe('a');
    expect(run(ready(), { type: 'ADJUST_LOCATION', direction: -1 }).locationId).toBe('c');
    expect(run(ready(), { type: 'SELECT_LOCATION', id: 'b' }, { type: 'ADJUST_LOCATION', direction: 1 }).locationId).toBe('c');
  });
  it('clamps volume and toggles mute/play', () => {
    expect(run(ready(), { type: 'SET_VOLUME', value: 3 }).volume).toBe(1);
    expect(run(ready(), { type: 'SET_VOLUME', value: NaN }).volume).toBe(ready().volume);
    expect(run(ready(), { type: 'MUTE' }).muted).toBe(true);
    expect(run(ready(), { type: 'TOGGLE_PLAY' }, { type: 'TOGGLE_PLAY' }).playing).toBe(false);
  });
  it('keeps playback state when the controller disconnects', () => {
    const s = run(ready(), { type: 'PLAY' }, { type: 'CONTROLLER', connected: true }, { type: 'CONTROLLER', connected: false });
    expect(s.playing).toBe(true);
    expect(s.controllerConnected).toBe(false);
  });
  it('uses 1 s per observation at 1× and 0.5 s at 2×', () => {
    expect(frameInterval(1)).toBe(1);
    expect(frameInterval(2)).toBe(0.5);
  });
});
