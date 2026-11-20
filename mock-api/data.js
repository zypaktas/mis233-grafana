'use strict';
/**
 * Deterministic synthetic sensor data for a few Boğaziçi University campus buildings.
 *
 * The same (building, metric, timestamp) always returns the same value, so a
 * dashboard shows stable data across refreshes, and anyone can reproduce it.
 * Values contain a daily rhythm, a weekend effect, noise and a few rare
 * injected anomalies (spikes / drops) that the AI panel can try to find.
 */

const BUILDINGS = [
  { id: 'albert-long-hall', name: 'Albert Long Hall' },
  { id: 'north-library', name: 'North Campus Library' },
  { id: 'kilyos-dorm', name: 'Kilyos Dormitory' },
  { id: 'sports-center', name: 'South Campus Sports Center' },
];

const METRICS = [
  { id: 'temperature', name: 'Temperature', unit: 'celsius', base: 19, daily: 2.5, noise: 0.3, weekend: -1.5 },
  { id: 'humidity', name: 'Humidity', unit: 'humidity', base: 48, daily: -8, noise: 1.2, weekend: 2 },
  { id: 'energy', name: 'Energy use', unit: 'kwatth', base: 120, daily: 70, noise: 6, weekend: -45 },
  { id: 'occupancy', name: 'Occupancy', unit: 'none', base: 140, daily: 130, noise: 9, weekend: -110 },
];

const MINUTE = 60 * 1000;
const ISTANBUL_OFFSET_H = 3;

/** Small, fast, deterministic hash → [0, 1). */
function hash01(...parts) {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Approximately normal noise from two hashes (Box–Muller). */
function gaussian(...parts) {
  const u = Math.max(1e-9, hash01('u', ...parts));
  const v = hash01('v', ...parts);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function buildingFactor(buildingId) {
  return 0.75 + hash01('factor', buildingId) * 0.5; // 0.75 .. 1.25
}

/** Ground truth: true when an anomaly was injected at this minute. */
function isAnomalyAt(buildingId, metricId, t) {
  const event = Math.floor(Math.floor(t / MINUTE) / 7);
  return hash01('anomaly', buildingId, metricId, event) < 0.01;
}

/** Value of one metric for one building at time t (ms), sampled on a 1-minute grid. */
function valueAt(buildingId, metric, t) {
  const minute = Math.floor(t / MINUTE);
  const local = new Date(minute * MINUTE + ISTANBUL_OFFSET_H * 3600 * 1000);
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  const day = local.getUTCDay();
  const weekend = day === 0 || day === 6;
  const f = buildingFactor(buildingId);

  // Daily rhythm peaking at ~14:00 local time.
  const daily = Math.cos(((hour - 14) / 24) * 2 * Math.PI);
  // Slow drift so that days are not identical (period ≈ 5 days).
  const drift = Math.sin((minute / (60 * 24 * 5)) * 2 * Math.PI + f * 10) * metric.daily * 0.15;
  // Smooth noise: average of hashed noise on the current and previous minutes.
  const noise = (gaussian(buildingId, metric.id, minute) + gaussian(buildingId, metric.id, minute - 1)) / 2;

  let v = metric.base * f + metric.daily * f * daily + drift + (weekend ? metric.weekend : 0) + noise * metric.noise;

  // Rare anomalies: ~1 in 700 minutes, lasting a few minutes.
  const event = Math.floor(minute / 7);
  if (isAnomalyAt(buildingId, metric.id, t)) {
    const dir = hash01('dir', buildingId, metric.id, event) < 0.7 ? 1 : -1;
    v += dir * (metric.noise * 8 + Math.abs(metric.daily) * 0.6);
  }

  if (metric.id === 'humidity') {
    v = Math.min(100, Math.max(0, v));
  }
  if (metric.id === 'occupancy' || metric.id === 'energy') {
    v = Math.max(0, v);
  }
  return Math.round(v * 100) / 100;
}

const AGGREGATIONS = {
  avg: (xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
  min: (xs) => Math.min(...xs),
  max: (xs) => Math.max(...xs),
  last: (xs) => xs[xs.length - 1],
};

/**
 * Points between from and to, one per `stepMs`, each the aggregation of the 1-minute
 * samples inside its bucket.
 */
function series(buildingId, metric, from, to, stepMs, agg, withTruth = false) {
  const aggFn = AGGREGATIONS[agg];
  const points = [];
  const start = Math.ceil(from / stepMs) * stepMs;
  for (let t = start; t <= to; t += stepMs) {
    const samples = [];
    let anomalous = false;
    for (let s = t - stepMs + MINUTE; s <= t; s += MINUTE) {
      samples.push(valueAt(buildingId, metric, s));
      anomalous = anomalous || isAnomalyAt(buildingId, metric.id, s);
    }
    const point = [t, Math.round(aggFn(samples) * 100) / 100];
    if (withTruth) {
      point.push(anomalous ? 1 : 0);
    }
    points.push(point);
  }
  return points;
}

/**
 * Second-resolution value for live streaming: linear interpolation between the
 * 1-minute values plus a little per-second jitter, so the live line matches
 * the historical data but still moves every second.
 */
function liveValueAt(buildingId, metric, t) {
  const minuteStart = Math.floor(t / MINUTE) * MINUTE;
  const a = valueAt(buildingId, metric, minuteStart);
  const b = valueAt(buildingId, metric, minuteStart + MINUTE);
  const frac = (t - minuteStart) / MINUTE;
  const second = Math.floor(t / 1000);
  const jitter = gaussian('live', buildingId, metric.id, second) * metric.noise * 0.25;
  return Math.round((a + (b - a) * frac + jitter) * 100) / 100;
}

module.exports = { BUILDINGS, METRICS, AGGREGATIONS, MINUTE, valueAt, liveValueAt, isAnomalyAt, series, hash01 };
