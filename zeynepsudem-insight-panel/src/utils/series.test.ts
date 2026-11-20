import { FieldType, toDataFrame } from '@grafana/data';
import { computeStats, formatValue, framesToSeries, nearestIndex, niceTicks } from './series';

describe('framesToSeries', () => {
  it('turns every numeric field into a sorted series and skips nulls', () => {
    const frame = toDataFrame({
      name: 'room',
      fields: [
        { name: 'time', type: FieldType.time, values: [3000, 1000, 2000] },
        { name: 'temp', type: FieldType.number, values: [3, 1, null] },
        { name: 'label', type: FieldType.string, values: ['a', 'b', 'c'] },
      ],
    });
    const [s] = framesToSeries([frame]);
    expect(s.points).toEqual([
      { t: 1000, v: 1 },
      { t: 3000, v: 3 },
    ]);
  });

  it('ignores frames without a time field', () => {
    const frame = toDataFrame({ fields: [{ name: 'v', type: FieldType.number, values: [1, 2] }] });
    expect(framesToSeries([frame])).toHaveLength(0);
  });

  it('makes duplicate series names unique', () => {
    const mk = () =>
      toDataFrame({
        fields: [
          { name: 'time', type: FieldType.time, values: [1] },
          { name: 'Value', type: FieldType.number, values: [1], config: { displayNameFromDS: 'same' } },
        ],
      });
    const names = framesToSeries([mk(), mk()]).map((s) => s.name);
    expect(new Set(names).size).toBe(2);
  });

  it('reads the anomaly_truth field as labels instead of a series', () => {
    const frame = toDataFrame({
      fields: [
        { name: 'time', type: FieldType.time, values: [1, 2, 3] },
        { name: 'temp', type: FieldType.number, values: [1, 9, 1] },
        { name: 'anomaly_truth', type: FieldType.number, values: [0, 1, 0] },
      ],
    });
    const series = framesToSeries([frame]);
    expect(series).toHaveLength(1);
    expect(series[0].truth).toEqual([false, true, false]);
  });
});

describe('helpers', () => {
  it('computes stats', () => {
    expect(
      computeStats([
        { t: 1, v: 2 },
        { t: 2, v: 4 },
        { t: 3, v: 9 },
      ])
    ).toEqual({ min: 2, max: 9, mean: 5, last: 9, count: 3 });
    expect(computeStats([])).toBeUndefined();
  });

  it('finds the nearest point by time', () => {
    const pts = [0, 10, 20, 30].map((t) => ({ t, v: t }));
    expect(nearestIndex(pts, 14)).toBe(1);
    expect(nearestIndex(pts, 16)).toBe(2);
    expect(nearestIndex(pts, -5)).toBe(0);
    expect(nearestIndex(pts, 99)).toBe(3);
    expect(nearestIndex([], 1)).toBe(-1);
  });

  it('makes round axis ticks', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(17.3, 29.1, 4)).toEqual([18, 20, 22, 24, 26, 28]);
    expect(niceTicks(5, 5, 3)).toEqual([5]);
  });

  it('formats values compactly', () => {
    expect(formatValue(1234)).toBe('1.2k');
    expect(formatValue(2500000)).toBe('2.5M');
    expect(formatValue(21.456)).toBe('21.46');
    expect(formatValue(0)).toBe('0');
    expect(formatValue(0.0123)).toBe('0.012');
  });
});
