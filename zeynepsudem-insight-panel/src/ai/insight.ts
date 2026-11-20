import { MLP } from './mlp';
import { Point } from '../utils/series';

/**
 * "Insight AI": forecasting + anomaly detection that runs entirely in the browser,
 * on the series Grafana passes to the panel.
 *
 * Method (see README, "AI method"):
 *  1. Features: the last `window` values (z-normalised) + time of day as sin/cos.
 *  2. Model: a tiny MLP trained with Adam to predict the next value.
 *  3. Anomalies: one-step-ahead residuals scored with a robust z-score (median / MAD).
 *     While walking the series, a flagged value is replaced by the model's own
 *     prediction ("online cleaning"), so one spike does not poison the next inputs.
 *  4. Robust re-training: the model is trained again on the cleaned series.
 *  5. Honest evaluation: a separate model is trained on the first 80 % and its one-step
 *     error on the last 20 % is compared with two baselines (last value, moving average).
 *  6. Forecast: recursive multi-step prediction with a 95 % band that widens with √h.
 *  7. If the data carries ground-truth anomaly labels, precision and event recall are reported.
 */

export interface AiOptions {
  window: number;
  hidden: number;
  epochs: number;
  /** Robust z-score above which a point is an anomaly. */
  sensitivity: number;
  /** Number of future points to forecast. */
  horizon: number;
}

export const DEFAULT_AI: AiOptions = { window: 12, hidden: 16, epochs: 60, sensitivity: 3.5, horizon: 24 };

export interface ForecastPoint {
  t: number;
  v: number;
  lo: number;
  hi: number;
}

export interface Anomaly {
  t: number;
  v: number;
  expected: number;
  z: number;
}

export interface Evaluation {
  mlpMae: number;
  naiveMae: number;
  movingAvgMae: number;
  /** % improvement of the MLP over the best baseline (negative = worse). */
  improvementPct: number;
  testPoints: number;
}

export interface TruthScore {
  precision: number;
  eventRecall: number;
  flagged: number;
  events: number;
}

export interface AiResult {
  forecast: ForecastPoint[];
  anomalies: Anomaly[];
  evaluation?: Evaluation;
  truth?: TruthScore;
  residualStd: number;
  stepMs: number;
  trainedOn: number;
  finalLoss: number;
  ms: number;
}

export class NotEnoughDataError extends Error {
  constructor(public readonly needed: number) {
    super(`Not enough data for the AI model (need at least ${needed} points).`);
  }
}

const DAY_MS = 86400000;

export function minPoints(o: AiOptions): number {
  return o.window * 3 + 10;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

function std(xs: number[], m = mean(xs)): number {
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length || 1));
}

export function median(xs: number[]): number {
  if (xs.length === 0) {
    return 0;
  }
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation scaled to be comparable with a standard deviation. */
export function robustScale(xs: number[]): { center: number; scale: number } {
  const center = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - center)));
  return { center, scale: 1.4826 * mad || std(xs) || 1 };
}

/**
 * Inputs: the last `window` values relative to the most recent one, the most recent
 * value itself, and the time of day. The model predicts the *change* from the most
 * recent value, so "predict no change" (the naive baseline) is the easy default it starts from.
 */
function features(values: number[], end: number, window: number, t: number): number[] {
  const last = values[end - 1];
  const x = values.slice(end - window, end - 1).map((v) => v - last);
  x.push(last);
  const phase = ((t % DAY_MS) / DAY_MS) * 2 * Math.PI;
  x.push(Math.sin(phase), Math.cos(phase));
  return x;
}

interface Scaler {
  m: number;
  s: number;
}

function fit(points: Point[], o: AiOptions, seed: number): { model: MLP; scaler: Scaler; loss: number } {
  const raw = points.map((p) => p.v);
  const m = mean(raw);
  const s = std(raw, m) || 1;
  const z = raw.map((v) => (v - m) / s);
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = o.window; i < z.length; i++) {
    X.push(features(z, i, o.window, points[i].t));
    y.push(z[i] - z[i - 1]);
  }
  const model = new MLP(o.window + 2, o.hidden, seed);
  const losses = model.train(X, y, { epochs: o.epochs, seed });
  return { model, scaler: { m, s }, loss: losses[losses.length - 1] ?? 0 };
}

function predictZ(model: MLP, zValues: number[], i: number, window: number, t: number): number {
  return zValues[i - 1] + model.predict(features(zValues, i, window, t));
}

function predictAt(model: MLP, sc: Scaler, zValues: number[], i: number, window: number, t: number): number {
  return predictZ(model, zValues, i, window, t) * sc.s + sc.m;
}

/**
 * Walks the series once, predicting each point from the (cleaned) previous ones.
 * Returns residuals and the cleaned series.
 */
function walk(points: Point[], model: MLP, sc: Scaler, o: AiOptions, threshold?: { center: number; scale: number }) {
  const cleanedZ = points.map((p) => (p.v - sc.m) / sc.s);
  const residuals: number[] = [];
  const predictions: number[] = [];
  const flagged: boolean[] = new Array(points.length).fill(false);
  for (let i = o.window; i < points.length; i++) {
    const pred = predictAt(model, sc, cleanedZ, i, o.window, points[i].t);
    const r = points[i].v - pred;
    predictions[i] = pred;
    residuals.push(r);
    if (threshold && Math.abs((r - threshold.center) / threshold.scale) > o.sensitivity) {
      flagged[i] = true;
      cleanedZ[i] = (pred - sc.m) / sc.s; // online cleaning
    }
  }
  return { residuals, predictions, flagged, cleaned: cleanedZ.map((z) => z * sc.s + sc.m) };
}

function evaluate(points: Point[], o: AiOptions, flagged: boolean[]): Evaluation | undefined {
  const split = Math.floor(points.length * 0.8);
  if (split < minPoints(o) || points.length - split < 5) {
    return undefined;
  }
  const { model, scaler } = fit(points.slice(0, split), o, 7);
  const z = points.map((p) => (p.v - scaler.m) / scaler.s);
  let mlp = 0;
  let naive = 0;
  let ma = 0;
  let n = 0;
  for (let i = split; i < points.length; i++) {
    if (flagged[i]) {
      continue; // anomalies are not "normal" behaviour, leave them out of the error
    }
    const v = points[i].v;
    mlp += Math.abs(v - predictAt(model, scaler, z, i, o.window, points[i].t));
    naive += Math.abs(v - points[i - 1].v);
    ma += Math.abs(v - mean(points.slice(i - o.window, i).map((p) => p.v)));
    n++;
  }
  if (n === 0) {
    return undefined;
  }
  const best = Math.min(naive, ma) / n;
  return {
    mlpMae: mlp / n,
    naiveMae: naive / n,
    movingAvgMae: ma / n,
    improvementPct: best > 0 ? ((best - mlp / n) / best) * 100 : 0,
    testPoints: n,
  };
}

/** Point precision and event recall against ground-truth labels (truth[i] = true for anomalous points). */
export function scoreAgainstTruth(flagged: boolean[], truth: boolean[]): TruthScore {
  let tp = 0;
  let fp = 0;
  for (let i = 0; i < truth.length; i++) {
    if (flagged[i]) {
      truth[i] ? tp++ : fp++;
    }
  }
  // An event is a run of consecutive labelled points. It counts as found when any point
  // in the run (or the point right after it, because a spike is often seen one step late) is flagged.
  let events = 0;
  let found = 0;
  let i = 0;
  while (i < truth.length) {
    if (!truth[i]) {
      i++;
      continue;
    }
    let j = i;
    let hit = false;
    while (j < truth.length && truth[j]) {
      hit = hit || !!flagged[j];
      j++;
    }
    hit = hit || !!flagged[j];
    events++;
    if (hit) {
      found++;
    }
    i = j;
  }
  return {
    precision: tp + fp ? tp / (tp + fp) : 1,
    eventRecall: events ? found / events : 1,
    flagged: tp + fp,
    events,
  };
}

export function analyze(points: Point[], options: Partial<AiOptions> = {}, truth?: boolean[]): AiResult {
  const started = Date.now();
  const o = { ...DEFAULT_AI, ...options };
  if (points.length < minPoints(o)) {
    throw new NotEnoughDataError(minPoints(o));
  }
  const stepMs = median(points.slice(1).map((p, i) => p.t - points[i].t)) || 60000;

  // Pass 1: fit on everything, find robust residual scale.
  const first = fit(points, o, 233);
  const pass1 = walk(points, first.model, first.scaler, o);
  const scale1 = robustScale(pass1.residuals);
  const detect1 = walk(points, first.model, first.scaler, o, scale1);

  // Pass 2: re-train on the cleaned series, detect again.
  const cleanedPoints = points.map((p, i) => ({ t: p.t, v: detect1.cleaned[i] }));
  const final = fit(cleanedPoints, o, 234);
  const pass2 = walk(points, final.model, final.scaler, o);
  const scale2 = robustScale(pass2.residuals);
  const detect2 = walk(points, final.model, final.scaler, o, scale2);

  const anomalies: Anomaly[] = [];
  detect2.flagged.forEach((f, i) => {
    if (f) {
      const r = points[i].v - detect2.predictions[i];
      anomalies.push({
        t: points[i].t,
        v: points[i].v,
        expected: detect2.predictions[i],
        z: (r - scale2.center) / scale2.scale,
      });
    }
  });

  // Forecast from the cleaned history.
  const z = detect2.cleaned.map((v) => (v - final.scaler.m) / final.scaler.s);
  const forecast: ForecastPoint[] = [];
  const lastT = points[points.length - 1].t;
  for (let h = 1; h <= o.horizon; h++) {
    const t = lastT + h * stepMs;
    const zPred = predictZ(final.model, z, z.length, o.window, t);
    z.push(zPred);
    const v = zPred * final.scaler.s + final.scaler.m;
    const band = 1.96 * scale2.scale * Math.sqrt(h);
    forecast.push({ t, v, lo: v - band, hi: v + band });
  }

  return {
    forecast,
    anomalies,
    evaluation: evaluate(cleanedPoints, o, detect2.flagged),
    truth: truth && truth.length === points.length ? scoreAgainstTruth(detect2.flagged, truth) : undefined,
    residualStd: scale2.scale,
    stepMs,
    trainedOn: points.length - o.window,
    finalLoss: final.loss,
    ms: Date.now() - started,
  };
}

export function fmtDuration(ms: number): string {
  if (ms < 90000) {
    return `${Math.round(ms / 1000)} s`;
  }
  const min = Math.round(ms / 60000);
  if (min < 90) {
    return `${min} min`;
  }
  const h = Math.round(min / 6) / 10;
  return `${h} h`;
}

/** Short, plain-language sentences describing the result. */
export function summarize(
  name: string,
  points: Point[],
  r: AiResult,
  fmtValue: (v: number) => string,
  fmtTime: (t: number) => string,
  sensitivity: number
): string[] {
  const out: string[] = [];
  const last = points[points.length - 1].v;
  const end = r.forecast[r.forecast.length - 1];
  if (end) {
    const delta = end.v - last;
    const trend = Math.abs(delta) < r.residualStd ? 'stay about the same' : delta > 0 ? 'rise' : 'fall';
    out.push(
      `Forecast: ${name} is expected to ${trend} (${fmtValue(last)} → ${fmtValue(end.v)}) over the next ${fmtDuration(
        end.t - points[points.length - 1].t
      )}; 95% band ${fmtValue(end.lo)} – ${fmtValue(end.hi)}.`
    );
  }
  if (r.anomalies.length === 0) {
    out.push(`Anomalies: none above ${sensitivity}σ.`);
  } else {
    const top = r.anomalies.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));
    out.push(
      `Anomalies: ${r.anomalies.length} unusual point${r.anomalies.length > 1 ? 's' : ''}; strongest ${top.z > 0 ? '+' : ''}${top.z.toFixed(
        1
      )}σ at ${fmtTime(top.t)} (value ${fmtValue(top.v)}, expected ≈ ${fmtValue(top.expected)}).`
    );
  }
  if (r.evaluation) {
    const e = r.evaluation;
    const verdict =
      e.improvementPct >= 0
        ? `${e.improvementPct.toFixed(0)}% better than`
        : `${(-e.improvementPct).toFixed(0)}% worse than`;
    out.push(
      `Model check (last 20%, ${e.testPoints} pts): AI error ${fmtValue(e.mlpMae)}, ${verdict} the best simple baseline (last value ${fmtValue(
        e.naiveMae
      )}, moving avg ${fmtValue(e.movingAvgMae)}).`
    );
  }
  if (r.truth) {
    out.push(
      `Ground truth: ${r.truth.events} labelled anomaly event${r.truth.events === 1 ? '' : 's'}, precision ${(
        r.truth.precision * 100
      ).toFixed(0)}%, event recall ${(r.truth.eventRecall * 100).toFixed(0)}%.`
    );
  }
  return out;
}
