import { describe, expect, it } from 'vitest';
import { parseLine, rateLimiter } from './serial';
import { keyToIntent } from './keyboard';

describe('serial protocol', () => {
  it('parses allowed intents', () => {
    expect(parseLine('{"type":"NEXT_FRAME"}')).toEqual({ type: 'NEXT_FRAME' });
    expect(parseLine(' {"type":"SET_FRAME","index":3}\r')).toEqual({ type: 'SET_FRAME', index: 3 });
    expect(parseLine('{"type":"ADJUST_LOCATION","direction":-1}')).toEqual({ type: 'ADJUST_LOCATION', direction: -1 });
    expect(parseLine('{"type":"SET_VOLUME","value":0.5}')).toEqual({ type: 'SET_VOLUME', value: 0.5 });
  });
  it('drops malformed, unknown or internal messages', () => {
    for (const bad of ['', 'garbage', '{"type":"INIT"}', '{"type":"CONTROLLER"}', '{"type":"SET_FRAME","index":"2"}',
      '{"type":"ADJUST_LOCATION","direction":5}', '[1,2]', `{"type":"PLAY","x":"${'a'.repeat(300)}"}`]) {
      expect(parseLine(bad)).toBeNull();
    }
  });
  it('rate-limits bursts', () => {
    let t = 0;
    const allow = rateLimiter(3, () => t);
    expect([allow(), allow(), allow(), allow()]).toEqual([true, true, true, false]);
    t = 1500;
    expect(allow()).toBe(true);
  });
});

describe('keyboard', () => {
  const k = (key: string) => ({ key, altKey: false, ctrlKey: false, metaKey: false });
  it('maps keys to intents', () => {
    expect(keyToIntent(k(' '), false)).toEqual({ type: 'TOGGLE_PLAY' });
    expect(keyToIntent(k('ArrowRight'), false)).toEqual({ type: 'NEXT_FRAME' });
    expect(keyToIntent(k('ArrowDown'), false)).toEqual({ type: 'ADJUST_LOCATION', direction: 1 });
    expect(keyToIntent(k('m'), true)).toEqual({ type: 'UNMUTE' });
  });
  it('leaves modified keys to the browser', () => {
    expect(keyToIntent({ ...k('ArrowRight'), metaKey: true }, false)).toBeNull();
  });
});
