'use strict';
/**
 * Campus Sensor API – a small mock REST (and, later, WebSocket) API used by the
 * zeynepsudem-campus-datasource Grafana plugin.
 *
 * Developed by Zeynep Sudem for MIS 233 (Boğaziçi University), Fall 2026.
 * REST uses only Node's built-in http module; the live stream uses the `ws` package.
 */
const http = require('http');
const { URL } = require('url');
const { BUILDINGS, METRICS, AGGREGATIONS, MINUTE, valueAt, series } = require('./data');
const { attachLive } = require('./live');

const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.API_KEY || ''; // when set, requests must send X-API-Key
const MAX_POINTS = 5000;
const VERSION = '1.0.0';

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-API-Key, Content-Type',
  });
  res.end(json);
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseTime(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const n = Number(value);
  if (Number.isFinite(n)) {
    return n;
  }
  const d = Date.parse(value);
  if (Number.isNaN(d)) {
    throw new ApiError(400, `Invalid time "${value}". Use epoch milliseconds or an ISO date.`);
  }
  return d;
}

function parseStep(value, from, to) {
  if (!value || value === 'auto') {
    // ~300 points for the range, rounded to whole minutes.
    return Math.max(MINUTE, Math.round((to - from) / 300 / MINUTE) * MINUTE);
  }
  const m = /^(\d+)(s|m|h)$/.exec(value);
  if (!m) {
    throw new ApiError(400, `Invalid interval "${value}". Use e.g. 1m, 5m, 1h or auto.`);
  }
  const ms = Number(m[1]) * { s: 1000, m: MINUTE, h: 60 * MINUTE }[m[2]];
  return Math.max(MINUTE, ms);
}

function pickBuildings(param) {
  if (!param || param === 'all' || param === '*') {
    return BUILDINGS;
  }
  const ids = param.split(',').map((s) => s.trim()).filter(Boolean);
  const found = BUILDINGS.filter((b) => ids.includes(b.id));
  if (found.length === 0) {
    throw new ApiError(404, `Unknown building "${param}". See /api/buildings.`);
  }
  return found;
}

function pickMetric(param) {
  const metric = METRICS.find((m) => m.id === (param || 'temperature'));
  if (!metric) {
    throw new ApiError(404, `Unknown metric "${param}". See /api/metrics.`);
  }
  return metric;
}

function readRange(q) {
  const now = Date.now();
  const to = parseTime(q.get('to'), now);
  const from = parseTime(q.get('from'), to - 6 * 3600 * 1000);
  if (from >= to) {
    throw new ApiError(400, '"from" must be before "to".');
  }
  return { from, to };
}

const routes = {
  '/api/health': () => ({ status: 'ok', service: 'campus-sensor-api', version: VERSION, developer: 'Zeynep Sudem', time: Date.now() }),

  '/api/buildings': () => BUILDINGS,

  '/api/metrics': () => METRICS.map(({ id, name, unit }) => ({ id, name, unit })),

  '/api/series': (q) => {
    const { from, to } = readRange(q);
    const metric = pickMetric(q.get('metric'));
    const buildings = pickBuildings(q.get('building'));
    const agg = q.get('agg') || 'avg';
    if (!AGGREGATIONS[agg]) {
      throw new ApiError(400, `Invalid aggregation "${agg}". Use one of: ${Object.keys(AGGREGATIONS).join(', ')}.`);
    }
    const step = parseStep(q.get('interval'), from, to);
    if ((to - from) / step > MAX_POINTS) {
      throw new ApiError(400, `Too many points (${Math.round((to - from) / step)}). Use a larger interval or a shorter range (max ${MAX_POINTS}).`);
    }
    return {
      metric: metric.id,
      unit: metric.unit,
      interval_ms: step,
      aggregation: agg,
      truth: q.get('truth') === '1',
      series: buildings.map((b) => ({ building: b.id, name: b.name, points: series(b.id, metric, from, to, step, agg, q.get('truth') === '1') })),
    };
  },

  '/api/summary': (q) => {
    const { from, to } = readRange(q);
    const metric = pickMetric(q.get('metric'));
    const buildings = pickBuildings(q.get('building'));
    const step = parseStep(q.get('interval'), from, to);
    return {
      metric: metric.id,
      unit: metric.unit,
      rows: buildings.map((b) => {
        const values = series(b.id, metric, from, to, step, 'avg').map((p) => p[1]);
        const avg = values.reduce((a, c) => a + c, 0) / (values.length || 1);
        const last = valueAt(b.id, metric, to);
        return {
          building: b.name,
          last,
          min: Math.min(...values),
          max: Math.max(...values),
          avg: Math.round(avg * 100) / 100,
          change_pct: avg ? Math.round(((last - avg) / Math.abs(avg)) * 1000) / 10 : 0,
          samples: values.length,
        };
      }),
    };
  },
};

function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const started = Date.now();
  res.on('finish', () => console.log(`${req.method} ${url.pathname}${url.search} → ${res.statusCode} (${Date.now() - started} ms)`));

  if (req.method === 'OPTIONS') {
    return send(res, 204, {});
  }
  try {
    if (req.method !== 'GET') {
      throw new ApiError(405, 'Only GET is supported.');
    }
    if (API_KEY && url.pathname !== '/api/health' && req.headers['x-api-key'] !== API_KEY) {
      throw new ApiError(401, 'Missing or wrong API key (X-API-Key header).');
    }
    // Error simulation for demos: ?simulate=500 or ?simulate=timeout
    const simulate = url.searchParams.get('simulate');
    if (simulate === 'timeout') {
      return; // never answer → the client sees a timeout
    }
    if (simulate && /^\d{3}$/.test(simulate)) {
      throw new ApiError(Number(simulate), `Simulated error ${simulate} (requested by the client).`);
    }
    const route = routes[url.pathname.replace(/\/+$/, '')];
    if (!route) {
      throw new ApiError(404, `No route ${url.pathname}. Try /api/health, /api/buildings, /api/metrics, /api/series, /api/summary.`);
    }
    send(res, 200, route(url.searchParams));
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    send(res, status, { error: err.message || 'Internal error' });
  }
}

function createServer() {
  const server = http.createServer(handler);
  attachLive(server);
  return server;
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`Campus Sensor API listening on :${PORT}, WebSocket on /live (developer: Zeynep Sudem)`));
}

module.exports = { createServer, handler };
