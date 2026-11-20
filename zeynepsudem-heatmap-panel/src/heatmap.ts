import { DataFrame, FieldType, getFieldDisplayName } from '@grafana/data';
import { ColorScheme } from './types';

export interface HeatmapRow {
  name: string;
  /** Value of the `building` label, used for dashboard variable drill-down. */
  id?: string;
  /** Average value per bucket, `null` when the bucket has no data. */
  cells: Array<number | null>;
}

export interface HeatmapGrid {
  rows: HeatmapRow[];
  bucketStarts: number[];
  bucketMs: number;
  min: number;
  max: number;
}

/**
 * Turns Grafana data frames (any number of time series) into a grid:
 * one row per numeric field, one column per equal-width time bucket.
 * Each cell is the average of the points that fall into the bucket.
 */
export function buildGrid(frames: DataFrame[], from: number, to: number, buckets: number): HeatmapGrid {
  const n = Math.max(1, Math.floor(buckets));
  const bucketMs = (to - from) / n;
  const bucketStarts = Array.from({ length: n }, (_, i) => from + i * bucketMs);
  const rows: HeatmapRow[] = [];
  let min = Infinity;
  let max = -Infinity;

  for (const frame of frames) {
    const time = frame.fields.find((f) => f.type === FieldType.time);
    if (!time) {
      continue;
    }
    for (const field of frame.fields) {
      if (field.type !== FieldType.number || field.name === 'anomaly_truth') {
        continue;
      }
      const sums = new Array<number>(n).fill(0);
      const counts = new Array<number>(n).fill(0);
      for (let i = 0; i < frame.length; i++) {
        const t = Number(time.values[i]);
        const v = field.values[i];
        if (v === null || v === undefined || !Number.isFinite(v) || t < from || t > to) {
          continue;
        }
        const b = Math.min(n - 1, Math.floor((t - from) / bucketMs));
        sums[b] += v;
        counts[b]++;
      }
      const cells = sums.map((s, i) => (counts[i] ? s / counts[i] : null));
      for (const c of cells) {
        if (c !== null) {
          min = Math.min(min, c);
          max = Math.max(max, c);
        }
      }
      rows.push({ name: getFieldDisplayName(field, frame, frames), id: field.labels?.building, cells });
    }
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 1;
  }
  return { rows, bucketStarts, bucketMs, min, max };
}

/** Colour stops for each scheme (perceptually ordered, readable on dark and light themes). */
const SCHEMES: Record<ColorScheme, string[]> = {
  heat: ['#1f1147', '#5b1a6e', '#a8306b', '#e85d47', '#fbb33c', '#fcf6a0'],
  cool: ['#0b1f3a', '#12466b', '#16768f', '#2ea7a0', '#8bd3a5', '#e6f5c9'],
  diverging: ['#2c62c7', '#6fa0e0', '#d9d9d9', '#f29b6b', '#c43d2f'],
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour for a value between min and max, linearly interpolated between the scheme's stops. */
export function colorFor(value: number, min: number, max: number, scheme: ColorScheme): string {
  const stops = SCHEMES[scheme] ?? SCHEMES.heat;
  const x = max === min ? 0.5 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  const pos = x * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  const c = a.map((ai, k) => Math.round(ai + (b[k] - ai) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Black or white text, whichever reads better on the cell colour. */
export function textColorOn(rgb: string): string {
  const [r, g, b] = (rgb.match(/\d+/g) ?? ['0', '0', '0']).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff';
}
