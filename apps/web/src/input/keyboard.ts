/**
 * Global keyboard shortcuts → intents. Ignored while the user is typing or operating a
 * native control (select, range, text field), so those keep their own key behaviour.
 *   Space  play/pause      ← / →  previous / next observation
 *   ↑ / ↓  previous / next location      M  mute / unmute
 */
import type { Intent } from '../state/store';

const OWN_KEYS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);

export function keyToIntent(e: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>, muted: boolean): Intent | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case ' ': return { type: 'TOGGLE_PLAY' };
    case 'ArrowRight': return { type: 'NEXT_FRAME' };
    case 'ArrowLeft': return { type: 'PREV_FRAME' };
    case 'ArrowDown': return { type: 'ADJUST_LOCATION', direction: 1 };
    case 'ArrowUp': return { type: 'ADJUST_LOCATION', direction: -1 };
    case 'm': case 'M': return { type: muted ? 'UNMUTE' : 'MUTE' };
    default: return null;
  }
}

export function attachKeyboard(dispatch: (i: Intent) => void, isMuted: () => boolean): () => void {
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (OWN_KEYS.has(el.tagName) || el.isContentEditable || el.closest('[data-own-keys]'))) return;
    const intent = keyToIntent(e, isMuted());
    if (!intent) return;
    e.preventDefault();
    dispatch(intent);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
