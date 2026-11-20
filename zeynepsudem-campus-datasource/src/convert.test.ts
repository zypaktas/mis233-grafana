import { FieldType } from '@grafana/data';
import { applyAlias, describeError, seriesToFrames, summaryToFrame, TRUTH_FIELD } from './convert';
import { ApiSeriesResponse, CampusQuery } from './types';

const query: CampusQuery = {
  refId: 'A',
  building: 'all',
  metric: 'temperature',
  aggregation: 'avg',
  interval: 'auto',
  format: 'timeseries',
};

const res: ApiSeriesResponse = {
  metric: 'temperature',
  unit: 'celsius',
  interval_ms: 60000,
  aggregation: 'avg',
  series: [
    {
      building: 'lib',
      name: 'Library',
      points: [
        [1, 20],
        [2, 21],
      ],
    },
    {
      building: 'gym',
      name: 'Gym',
      points: [
        [1, 18],
        [2, 19],
      ],
    },
  ],
};

describe('seriesToFrames', () => {
  it('creates one time series frame per building with unit and labels', () => {
    const frames = seriesToFrames(res, query);
    expect(frames).toHaveLength(2);
    const [time, value] = frames[0].fields;
    expect(time.type).toBe(FieldType.time);
    expect(value.values).toEqual([20, 21]);
    expect(value.config.unit).toBe('celsius');
    expect(value.labels).toEqual({ building: 'lib' });
    expect(value.config.displayNameFromDS).toBe('Library');
    expect(frames[0].refId).toBe('A');
  });

  it('applies the alias template', () => {
    const frames = seriesToFrames(res, { ...query, alias: '{{building}} – {{metric}}' });
    expect(frames[1].fields[1].config.displayNameFromDS).toBe('Gym – temperature');
    expect(applyAlias(undefined, 'a', 'b')).toBeUndefined();
  });

  it('adds the ground-truth field when the points carry labels', () => {
    const withTruth: ApiSeriesResponse = {
      ...res,
      series: [
        {
          building: 'lib',
          name: 'Library',
          points: [
            [1, 20, 0],
            [2, 30, 1],
          ],
        },
      ],
    };
    const [frame] = seriesToFrames(withTruth, query);
    const truth = frame.fields.find((f) => f.name === TRUTH_FIELD);
    expect(truth?.values).toEqual([0, 1]);
  });
});

it('summaryToFrame builds a table with one row per building', () => {
  const frame = summaryToFrame(
    {
      metric: 'energy',
      unit: 'kwatth',
      rows: [{ building: 'Library', last: 1, min: 0, max: 2, avg: 1, change_pct: 5, samples: 10 }],
    },
    { ...query, format: 'table' }
  );
  expect(frame.fields.map((f) => f.name)).toEqual([
    'Building',
    'Last',
    'Min',
    'Max',
    'Average',
    'Change vs avg',
    'Samples',
  ]);
  expect(frame.length).toBe(1);
});

describe('describeError', () => {
  it('explains an unreachable API', () => {
    expect(describeError({ status: 502, data: { error: 'Bad Gateway' } }, 'http://api')).toMatch(
      /unreachable \(http:\/\/api\)/
    );
  });
  it('passes on the API error message', () => {
    expect(describeError({ status: 404, data: { error: 'Unknown building "x"' } })).toBe(
      'Campus API error 404: Unknown building "x"'
    );
  });
  it('mentions the API key on 401', () => {
    expect(describeError({ status: 401 })).toMatch(/API key/);
  });
  it('handles plain errors', () => {
    expect(describeError(new Error('boom'))).toMatch(/boom/);
  });
});
