/**
 * Research check: runs the Insight AI on every building × metric of the mock Campus API
 * at three resolutions and compares it with the API's ground-truth anomaly labels and
 * with two simple forecasting baselines. The table is printed and summarised in the README.
 */
import { analyze } from './insight';

// Plain CommonJS module from the mock API (same data the data source serves).

const api = require('../../../mock-api/data.js');

const NOW = Date.UTC(2026, 10, 20, 9, 0);
const SETUPS = [
  { label: '6 h @ 1 min', hours: 6, stepMin: 1 },
  { label: '24 h @ 5 min', hours: 24, stepMin: 5 },
  { label: '72 h @ 15 min', hours: 72, stepMin: 15 },
];

it('detects injected anomalies and beats simple baselines on average', () => {
  const rows: Array<Record<string, string | number>> = [];
  for (const setup of SETUPS) {
    for (const b of api.BUILDINGS) {
      for (const m of api.METRICS) {
        const raw: number[][] = api.series(b.id, m, NOW - setup.hours * 3600e3, NOW, setup.stepMin * 60e3, 'avg', true);
        const points = raw.map((p) => ({ t: p[0], v: p[1] }));
        const truth = raw.map((p) => p[2] === 1);
        const r = analyze(points, {}, truth);
        rows.push({
          setup: setup.label,
          series: `${b.id}/${m.id}`,
          improvement: r.evaluation ? r.evaluation.improvementPct : 0,
          events: r.truth!.events,
          flagged: r.truth!.flagged,
          precision: r.truth!.precision,
          recall: r.truth!.eventRecall,
          ms: r.ms,
        });
      }
    }
  }
  const avg = (k: string, filter = (_r: Record<string, string | number>) => true) => {
    const xs = rows.filter(filter).map((r) => Number(r[k]));
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const summary = SETUPS.map((s) => ({
    setup: s.label,
    'avg improvement %': avg('improvement', (r) => r.setup === s.label).toFixed(1),
    'avg precision': avg('precision', (r) => r.setup === s.label && Number(r.flagged) > 0).toFixed(2),
    'avg event recall': avg('recall', (r) => r.setup === s.label && Number(r.events) > 0).toFixed(2),
    'avg ms': avg('ms', (r) => r.setup === s.label).toFixed(0),
  }));
  process.stdout.write(`\nInsight AI research check (${rows.length} series)\n${JSON.stringify(summary, null, 2)}\n`);

  // Sensitivity sweep on the noisiest setup (1-minute data): precision / recall trade-off.
  const sweep = [2.5, 3.5, 4.5, 5.5].map((sensitivity) => {
    let tp = 0;
    let flagged = 0;
    let events = 0;
    let recalled = 0;
    for (const b of api.BUILDINGS) {
      for (const m of api.METRICS) {
        const raw: number[][] = api.series(b.id, m, NOW - 6 * 3600e3, NOW, 60e3, 'avg', true);
        const r = analyze(
          raw.map((p) => ({ t: p[0], v: p[1] })),
          { sensitivity },
          raw.map((p) => p[2] === 1)
        );
        flagged += r.truth!.flagged;
        tp += r.truth!.precision * r.truth!.flagged;
        events += r.truth!.events;
        recalled += r.truth!.eventRecall * r.truth!.events;
      }
    }
    return {
      sensitivity,
      flagged,
      precision: flagged ? (tp / flagged).toFixed(2) : '-',
      'event recall': events ? (recalled / events).toFixed(2) : '-',
    };
  });
  process.stdout.write(`Sensitivity sweep, 6 h @ 1 min (16 series)\n${JSON.stringify(sweep, null, 2)}\n`);

  expect(avg('improvement')).toBeGreaterThan(10);
  expect(avg('recall', (r) => Number(r.events) > 0)).toBeGreaterThan(0.85);
  expect(avg('precision', (r) => Number(r.flagged) > 0)).toBeGreaterThan(0.6);
});
