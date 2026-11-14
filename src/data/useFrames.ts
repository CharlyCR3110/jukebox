import { useEffect, useState } from 'react';
import type { DatasetDef } from './datasets';
import { loadFrameSet, type FrameSet } from './frames';

export type FramesState =
  | { status: 'loading'; progress: number; set: null }
  | { status: 'ready'; progress: 12; set: FrameSet }
  | { status: 'error'; progress: number; set: null; error: string };

export function useFrames(dataset: DatasetDef, year: number, nonce = 0): FramesState {
  const [state, setState] = useState<FramesState>({ status: 'loading', progress: 0, set: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', progress: 0, set: null });
    loadFrameSet(
      dataset,
      year,
      (n) => !cancelled && setState((s) => (s.status === 'loading' ? { ...s, progress: n } : s)),
      () => cancelled,
    )
      .then((set) => !cancelled && setState({ status: 'ready', progress: 12, set }))
      .catch((e: Error) => {
        if (!cancelled) setState({ status: 'error', progress: 0, set: null, error: e.message });
      });
    return () => { cancelled = true; };
  }, [dataset, year, nonce]);

  return state;
}
