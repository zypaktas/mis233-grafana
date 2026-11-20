'use strict';
/**
 * WebSocket live stream: ws://<host>:8080/live
 *
 * Client → server:  {"type":"subscribe","building":"all"|"<id>[,<id>]","metric":"temperature","intervalMs":1000}
 * Server → client:  {"type":"subscribed", ...}
 *                   {"type":"points","t":<ms>,"metric":"temperature","points":[{"building":"..","name":"..","v":21.3}, ...]}
 *                   {"type":"error","message":"..."}
 *
 * Read-only demo data, so no API key is needed here (the browser connects directly).
 */
const { WebSocketServer } = require('ws');
const { BUILDINGS, METRICS, liveValueAt } = require('./data');

const MIN_INTERVAL = 250;
const MAX_INTERVAL = 10000;

function resolveSubscription(msg) {
  const metric = METRICS.find((m) => m.id === (msg.metric || 'temperature'));
  if (!metric) {
    throw new Error(`Unknown metric "${msg.metric}"`);
  }
  let buildings = BUILDINGS;
  if (msg.building && msg.building !== 'all' && msg.building !== '*') {
    const ids = String(msg.building).split(',').map((s) => s.trim());
    buildings = BUILDINGS.filter((b) => ids.includes(b.id));
    if (buildings.length === 0) {
      throw new Error(`Unknown building "${msg.building}"`);
    }
  }
  const intervalMs = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Number(msg.intervalMs) || 1000));
  return { metric, buildings, intervalMs };
}

function attachLive(server) {
  const wss = new WebSocketServer({ server, path: '/live' });

  wss.on('connection', (socket, req) => {
    console.log(`WS connect from ${req.socket.remoteAddress} (${wss.clients.size} clients)`);
    let timer = null;

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const send = (obj) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(obj));
      }
    };

    send({ type: 'hello', service: 'campus-sensor-api', developer: 'Zeynep Sudem', hint: 'send {"type":"subscribe","metric":"temperature","building":"all"}' });

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send({ type: 'error', message: 'Messages must be JSON.' });
      }
      if (msg.type === 'unsubscribe') {
        stop();
        return send({ type: 'unsubscribed' });
      }
      if (msg.type !== 'subscribe') {
        return send({ type: 'error', message: `Unknown message type "${msg.type}".` });
      }
      let sub;
      try {
        sub = resolveSubscription(msg);
      } catch (err) {
        return send({ type: 'error', message: err.message });
      }
      stop();
      send({ type: 'subscribed', metric: sub.metric.id, unit: sub.metric.unit, buildings: sub.buildings.map((b) => b.id), intervalMs: sub.intervalMs });
      const tick = () => {
        const t = Date.now();
        send({
          type: 'points',
          t,
          metric: sub.metric.id,
          points: sub.buildings.map((b) => ({ building: b.id, name: b.name, v: liveValueAt(b.id, sub.metric, t) })),
        });
      };
      tick();
      timer = setInterval(tick, sub.intervalMs);
    });

    socket.on('close', () => {
      stop();
      console.log(`WS disconnect (${wss.clients.size} clients)`);
    });
    socket.on('error', stop);
  });

  return wss;
}

module.exports = { attachLive, resolveSubscription };
