import { of, throwError, lastValueFrom, toArray } from 'rxjs';
import { dateTime, DataQueryRequest, DataSourceInstanceSettings } from '@grafana/data';
import { DataSource } from './datasource';
import { CampusOptions, CampusQuery } from './types';

const fetchMock = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: fetchMock }),
  getTemplateSrv: () => ({ replace: (s: string) => s.replace('$building', 'lib'), getVariables: () => [] }),
}));

const settings = {
  id: 1,
  uid: 'campus',
  type: 'zeynepsudem-campus-datasource',
  name: 'Campus',
  url: '/api/datasources/proxy/uid/campus',
  jsonData: { apiUrl: 'http://campus-api:8080/api', wsUrl: 'ws://localhost:8080/live' },
  meta: {} as any,
  readOnly: false,
  access: 'proxy',
} as unknown as DataSourceInstanceSettings<CampusOptions>;

function request(targets: Array<Partial<CampusQuery>>): DataQueryRequest<CampusQuery> {
  return {
    targets: targets.map((t, i) => ({ refId: String.fromCharCode(65 + i), ...t })) as CampusQuery[],
    range: { from: dateTime(0), to: dateTime(3600000), raw: { from: 'now-1h', to: 'now' } },
    scopedVars: {},
  } as unknown as DataQueryRequest<CampusQuery>;
}

beforeEach(() => fetchMock.mockReset());

it('queries the series endpoint through the Grafana proxy with all parameters', async () => {
  fetchMock.mockReturnValue(
    of({
      data: {
        metric: 'temperature',
        unit: 'celsius',
        interval_ms: 60000,
        aggregation: 'max',
        series: [{ building: 'lib', name: 'Library', points: [[0, 1]] }],
      },
    })
  );
  const ds = new DataSource(settings);
  const responses = await lastValueFrom(
    ds.query(request([{ building: '$building', metric: 'temperature', aggregation: 'max' }])).pipe(toArray())
  );
  const call = fetchMock.mock.calls[0][0];
  expect(call.url).toBe('/api/datasources/proxy/uid/campus/api/series');
  expect(call.params).toMatchObject({ building: 'lib', metric: 'temperature', agg: 'max', from: '0', to: '3600000' });
  expect(responses[0].data).toHaveLength(1);
});

it('uses the summary endpoint for table format', async () => {
  fetchMock.mockReturnValue(of({ data: { metric: 'energy', unit: 'kwatth', rows: [] } }));
  const ds = new DataSource(settings);
  await lastValueFrom(ds.query(request([{ metric: 'energy', format: 'table' }])));
  expect(fetchMock.mock.calls[0][0].url).toMatch(/\/summary$/);
});

it('turns a failing query into a readable error without hiding other queries', async () => {
  fetchMock
    .mockReturnValueOnce(throwError(() => ({ status: 404, data: { error: 'Unknown building "x"' } })))
    .mockReturnValueOnce(
      of({ data: { metric: 'energy', unit: 'kwatth', interval_ms: 1, aggregation: 'avg', series: [] } })
    );
  const ds = new DataSource(settings);
  const responses = await lastValueFrom(
    ds.query(request([{ building: 'x', metric: 'temperature' }, { metric: 'energy' }])).pipe(toArray())
  );
  const failed = responses.find((r) => r.errors?.length);
  expect(failed?.errors?.[0]).toMatchObject({ refId: 'A', message: 'Campus API error 404: Unknown building "x"' });
  expect(responses.some((r) => !r.errors)).toBe(true);
});

it('testDatasource reports success and failure', async () => {
  const ds = new DataSource(settings);
  fetchMock
    .mockReturnValueOnce(of({ data: { status: 'ok', version: '1.0.0', developer: 'Zeynep Sudem' } }))
    .mockReturnValueOnce(of({ data: [{ id: 'a', name: 'A' }] }));
  expect(await ds.testDatasource()).toMatchObject({ status: 'success' });
  fetchMock.mockReturnValueOnce(throwError(() => ({ status: 502 })));
  expect(await ds.testDatasource()).toMatchObject({ status: 'error', message: expect.stringMatching(/unreachable/) });
});

it('metricFindQuery returns buildings for dashboard variables', async () => {
  fetchMock.mockReturnValue(of({ data: [{ id: 'lib', name: 'Library' }] }));
  const ds = new DataSource(settings);
  expect(await ds.metricFindQuery('buildings')).toEqual([{ text: 'Library', value: 'lib' }]);
  await expect(ds.metricFindQuery('nope')).rejects.toThrow(/buildings/);
});
