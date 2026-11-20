import { useEffect, useRef, useState } from 'react';
import { Series } from '../utils/series';
import { AiResult, analyze } from './insight';

export interface AiState {
  result?: AiResult;
  error?: string;
  /** The series the result belongs to. */
  seriesName?: string;
}

/** At most this many recent points are used, so training stays well under ~100 ms. */
const MAX_POINTS = 1500;
/** While streaming, retrain at most this often. */
const LIVE_RETRAIN_MS = 15000;

/**
 * Runs the Insight AI on one series, outside the render pass (setTimeout), and only
 * again when the data or the AI options really change.
 */
export function useInsightAI(
  series: Series | undefined,
  enabled: boolean,
  horizon: number,
  sensitivity: number,
  streaming: boolean
): AiState {
  const [state, setState] = useState<AiState>({});
  const lastRun = useRef(0);

  const n = series?.points.length ?? 0;
  const key = series
    ? `${series.name}|${n}|${series.points[0]?.t}|${series.points[n - 1]?.t}|${horizon}|${sensitivity}|${enabled}`
    : 'none';

  useEffect(() => {
    if (!enabled || !series) {
      return; // the panel ignores stale results while the AI is off
    }
    if (streaming && state.result && Date.now() - lastRun.current < LIVE_RETRAIN_MS) {
      return;
    }
    const id = setTimeout(() => {
      lastRun.current = Date.now();
      const start = Math.max(0, series.points.length - MAX_POINTS);
      const points = series.points.slice(start);
      const truth = series.truth?.slice(start);
      try {
        setState({ result: analyze(points, { horizon, sensitivity }, truth), seriesName: series.name });
      } catch (err) {
        setState({ error: (err as Error).message, seriesName: series.name });
      }
    }, 0);
    return () => clearTimeout(id);
    // `key` captures every input that matters; series identity changes on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
