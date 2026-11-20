import { analyze, fmtDuration, median, NotEnoughDataError, robustScale, scoreAgainstTruth, summarize } from './insight';
import { seededRandom } from './mlp';

/** Daily-ish sine wave with noise and a few injected spikes (the ground truth). */
function synthetic(n = 400, spikes = [120, 250, 330]) {
  const rnd = seededRandom(9);
  const step = 5 * 60000;
  const points = [];
  const truth: boolean[] = [];
  for (let i = 0; i < n; i++) {
    let v = 20 + 4 * Math.sin((i / 288) * 2 * Math.PI) + (rnd() - 0.5) * 0.4;
    const spike = spikes.includes(i);
    if (spike) {
      v += 6;
    }
    points.push({ t: Date.UTC(2026, 10, 1) + i * step, v });
    truth.push(spike);
  }
  return { points, truth };
}

describe('robust statistics', () => {
  it('median and MAD ignore outliers', () => {
    expect(median([1, 2, 3, 100])).toBe(2.5);
    const { center, scale } = robustScale([1, 1.1, 0.9, 1, 50]);
    expect(center).toBe(1);
    expect(scale).toBeLessThan(1);
  });
});

describe('analyze', () => {
  it('finds the injected spikes and forecasts the requested horizon', () => {
    const { points, truth } = synthetic();
    const r = analyze(points, { horizon: 12 }, truth);
    const found = r.anomalies.map((a) => a.t);
    for (const i of [120, 250, 330]) {
      expect(found).toContain(points[i].t);
    }
    expect(r.truth!.eventRecall).toBe(1);
    expect(r.truth!.precision).toBeGreaterThanOrEqual(0.75);
    expect(r.forecast).toHaveLength(12);
    expect(r.forecast[0].t).toBe(points[points.length - 1].t + 5 * 60000);
    // the band widens with the horizon
    const w = (f: { lo: number; hi: number }) => f.hi - f.lo;
    expect(w(r.forecast[11])).toBeGreaterThan(w(r.forecast[0]));
  });

  it('beats the naive baselines on a smooth seasonal series', () => {
    const { points } = synthetic(500, []);
    const r = analyze(points);
    expect(r.evaluation).toBeDefined();
    expect(r.evaluation!.mlpMae).toBeLessThan(r.evaluation!.movingAvgMae);
  });

  it('refuses series that are too short', () => {
    expect(() => analyze(synthetic(20, []).points)).toThrow(NotEnoughDataError);
  });

  it('writes a readable summary', () => {
    const { points, truth } = synthetic();
    const r = analyze(points, {}, truth);
    const lines = summarize(
      'Room',
      points,
      r,
      (v) => v.toFixed(1),
      () => 'T',
      3.5
    );
    expect(lines[0]).toMatch(/^Forecast: Room is expected to/);
    expect(lines[1]).toMatch(/^Anomalies: \d+ unusual point/);
    expect(lines.some((l) => l.startsWith('Ground truth'))).toBe(true);
  });
});

describe('scoreAgainstTruth', () => {
  it('counts point precision and event recall', () => {
    const truth = [false, true, true, false, false, true, false];
    const flagged = [false, false, true, false, true, false, false];
    const s = scoreAgainstTruth(flagged, truth);
    expect(s.events).toBe(2);
    expect(s.eventRecall).toBe(0.5);
    expect(s.precision).toBe(0.5);
  });

  it('accepts a detection one step after the event', () => {
    expect(scoreAgainstTruth([false, false, true], [false, true, false]).eventRecall).toBe(1);
  });
});

it('formats durations', () => {
  expect(fmtDuration(30000)).toBe('30 s');
  expect(fmtDuration(45 * 60000)).toBe('45 min');
  expect(fmtDuration(3 * 3600000)).toBe('3 h');
});
