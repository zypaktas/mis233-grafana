'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../server');
const data = require('../data');

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};

test('health names the developer', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.developer, 'Zeynep Sudem');
});

test('series returns one series per building with the requested step', async () => {
  const to = Date.UTC(2026, 10, 20, 12);
  const { status, body } = await get(`/api/series?metric=energy&building=all&from=${to - 3600e3}&to=${to}&interval=15m&agg=max`);
  assert.equal(status, 200);
  assert.equal(body.series.length, data.BUILDINGS.length);
  assert.equal(body.interval_ms, 15 * 60e3);
  assert.equal(body.series[0].points.length, 5);
});

test('data is deterministic and truth labels are optional', async () => {
  const q = '/api/series?metric=temperature&building=north-library&from=1795100000000&to=1795110000000&interval=5m';
  const a = await get(q);
  const b = await get(q + '&truth=1');
  assert.deepEqual(a.body.series[0].points.map((p) => p[1]), b.body.series[0].points.map((p) => p[1]));
  assert.equal(a.body.series[0].points[0].length, 2);
  assert.equal(b.body.series[0].points[0].length, 3);
});

test('summary returns a row per building', async () => {
  const { body } = await get('/api/summary?metric=humidity&building=north-library,kilyos-dorm');
  assert.equal(body.rows.length, 2);
  assert.ok(body.rows.every((r) => r.min <= r.avg && r.avg <= r.max));
});

test('validation errors are clear', async () => {
  assert.equal((await get('/api/series?metric=nope')).status, 404);
  assert.equal((await get('/api/series?building=nope')).status, 404);
  assert.equal((await get('/api/series?agg=median')).status, 400);
  assert.equal((await get('/api/series?interval=abc')).status, 400);
  assert.equal((await get('/api/series?from=10&to=5')).status, 400);
  assert.match((await get('/api/series?from=0&to=99999999999&interval=1m')).body.error, /Too many points/);
  assert.equal((await get('/api/nothing')).status, 404);
  assert.equal((await get('/api/series?simulate=503')).status, 503);
});

test('injected anomalies are visible in the data', () => {
  const metric = data.METRICS[0];
  let found = 0;
  for (let t = 1795000000000; t < 1795000000000 + 7 * 86400e3; t += 60e3) {
    if (data.isAnomalyAt('albert-long-hall', metric.id, t)) {
      found++;
      const normal = data.valueAt('albert-long-hall', metric, t - 30 * 60e3);
      assert.ok(Math.abs(data.valueAt('albert-long-hall', metric, t) - normal) > 1);
    }
  }
  assert.ok(found > 0);
});

test('WebSocket streams points after subscribe and reports bad input', async () => {
  const ws = new WebSocket(`ws://localhost:${server.address().port}/live`);
  const messages = [];
  await new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.on('message', (m) => {
      const msg = JSON.parse(m.toString());
      messages.push(msg);
      if (msg.type === 'hello') {
        ws.send(JSON.stringify({ type: 'subscribe', metric: 'occupancy', building: 'sports-center', intervalMs: 250 }));
      }
      if (messages.filter((x) => x.type === 'points').length === 2) {
        ws.send(JSON.stringify({ type: 'subscribe', metric: 'nope' }));
      }
      if (msg.type === 'error') {
        resolve();
      }
    });
  });
  ws.close();
  const points = messages.filter((m) => m.type === 'points');
  assert.equal(points[0].points[0].building, 'sports-center');
  assert.ok(points[1].t > points[0].t);
  assert.match(messages[messages.length - 1].message, /Unknown metric/);
});
