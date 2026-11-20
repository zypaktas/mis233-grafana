import { FieldType, toDataFrame } from '@grafana/data';
import { buildGrid, colorFor, textColorOn } from './heatmap';

const frame = toDataFrame({
  name: 'Library',
  fields: [
    { name: 'time', type: FieldType.time, values: [0, 10, 20, 30, 90] },
    { name: 'energy', type: FieldType.number, values: [1, 3, 5, null, 9], labels: { building: 'north-library' } },
    { name: 'anomaly_truth', type: FieldType.number, values: [0, 0, 0, 0, 1] },
  ],
});

describe('buildGrid', () => {
  it('averages points into equal time buckets and keeps the building id', () => {
    const g = buildGrid([frame], 0, 100, 4);
    expect(g.rows).toHaveLength(1); // the truth field is not a row
    expect(g.rows[0].id).toBe('north-library');
    expect(g.rows[0].cells).toEqual([3, null, null, 9]);
    expect(g.min).toBe(3);
    expect(g.max).toBe(9);
    expect(g.bucketStarts).toEqual([0, 25, 50, 75]);
  });

  it('handles empty input', () => {
    const g = buildGrid([], 0, 100, 4);
    expect(g.rows).toHaveLength(0);
    expect([g.min, g.max]).toEqual([0, 1]);
  });
});

describe('colours', () => {
  it('maps min and max to the ends of the scheme', () => {
    expect(colorFor(0, 0, 10, 'heat')).toBe('rgb(31, 17, 71)');
    expect(colorFor(10, 0, 10, 'heat')).toBe('rgb(252, 246, 160)');
    expect(colorFor(99, 0, 10, 'heat')).toBe(colorFor(10, 0, 10, 'heat'));
  });

  it('picks readable text', () => {
    expect(textColorOn('rgb(252, 246, 160)')).toBe('#111');
    expect(textColorOn('rgb(31, 17, 71)')).toBe('#fff');
  });
});
