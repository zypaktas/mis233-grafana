import { DataFrame, FieldType, getFieldDisplayName } from '@grafana/data';

export interface Point {
  t: number;
  v: number;
}

export interface Series {
  name: string;
  points: Point[];
}

export interface Stats {
  min: number;
  max: number;
  mean: number;
  last: number;
  count: number;
}

/**
 * Turns the data frames Grafana gives a panel into plain [time, value] series.
 * Every numeric field of a frame that also has a time field becomes one series.
 * Null / NaN values are skipped and points are sorted by time.
 */
export function framesToSeries(frames: DataFrame[]): Series[] {
  const result: Series[] = [];
  for (const frame of frames) {
    const timeField = frame.fields.find((f) => f.type === FieldType.time);
    if (!timeField) {
      continue;
    }
    for (const field of frame.fields) {
      if (field.type !== FieldType.number) {
        continue;
      }
      const points: Point[] = [];
      for (let i = 0; i < frame.length; i++) {
        const t = Number(timeField.values[i]);
        const v = field.values[i];
        if (v === null || v === undefined || !Number.isFinite(v) || !Number.isFinite(t)) {
          continue;
        }
        points.push({ t, v });
      }
      points.sort((a, b) => a.t - b.t);
      if (points.length > 0) {
        result.push({ name: getFieldDisplayName(field, frame, frames), points });
      }
    }
  }
  // Series names are used as React keys and legend toggles, so they must be unique.
  const seen = new Map<string, number>();
  for (const s of result) {
    const n = seen.get(s.name) ?? 0;
    seen.set(s.name, n + 1);
    if (n > 0) {
      s.name = `${s.name} (${n + 1})`;
    }
  }
  return result;
}

export function computeStats(points: Point[]): Stats | undefined {
  if (points.length === 0) {
    return undefined;
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const p of points) {
    min = Math.min(min, p.v);
    max = Math.max(max, p.v);
    sum += p.v;
  }
  return { min, max, mean: sum / points.length, last: points[points.length - 1].v, count: points.length };
}

/** Index of the point whose time is closest to `t` (binary search, points must be sorted). */
export function nearestIndex(points: Point[], t: number): number {
  if (points.length === 0) {
    return -1;
  }
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Math.abs(points[lo].t - t) <= Math.abs(points[hi].t - t) ? lo : hi;
}

/** "Nice" round tick values between min and max (1, 2, 5 x 10^n steps). */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count < 1) {
    return [];
  }
  if (min === max) {
    return [min];
  }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

/** Compact number formatting for axis labels and the stats strip. */
export function formatValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) {
    return (v / 1e9).toFixed(1) + 'B';
  }
  if (abs >= 1e6) {
    return (v / 1e6).toFixed(1) + 'M';
  }
  if (abs >= 1e3) {
    return (v / 1e3).toFixed(1) + 'k';
  }
  if (abs >= 100 || v === 0) {
    return v.toFixed(0);
  }
  if (abs >= 1) {
    return v.toFixed(2);
  }
  return v.toPrecision(2);
}
