import { getBackendSrv, getTemplateSrv } from '@grafana/runtime';
import {
  CoreApp,
  DataFrame,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  LoadingState,
  MetricFindValue,
  ScopedVars,
  TestDataSourceResponse,
} from '@grafana/data';
import { catchError, from as fromPromise, lastValueFrom, map, merge, mergeMap, Observable, of } from 'rxjs';

import { ApiOption, ApiSeriesResponse, ApiSummaryResponse, CampusOptions, CampusQuery, DEFAULT_QUERY } from './types';
import { describeError, seriesToFrames, summaryToFrame } from './convert';
import { liveStream } from './live';

/**
 * Campus Sensors data source.
 *
 * All REST calls go through Grafana's data proxy (`/api/datasources/proxy/uid/<uid>/api/...`),
 * which forwards them to the configured API URL and adds the secret API key header.
 * The browser therefore never sees the key, and there are no CORS problems.
 */
export class DataSource extends DataSourceApi<CampusQuery, CampusOptions> {
  readonly proxyUrl: string;
  readonly apiUrl?: string;
  readonly wsUrl?: string;

  constructor(instanceSettings: DataSourceInstanceSettings<CampusOptions>) {
    super(instanceSettings);
    this.proxyUrl = `${instanceSettings.url}/api`;
    this.apiUrl = instanceSettings.jsonData.apiUrl;
    this.wsUrl = instanceSettings.jsonData.wsUrl;
  }

  getDefaultQuery(_: CoreApp): Partial<CampusQuery> {
    return DEFAULT_QUERY;
  }

  filterQuery(query: CampusQuery): boolean {
    return !query.hide && !!query.metric;
  }

  /** Resolves dashboard variables ($building, ${metric}, …) inside a query. */
  applyTemplateVariables(query: CampusQuery, scopedVars: ScopedVars): CampusQuery {
    const srv = getTemplateSrv();
    return {
      ...query,
      building: srv.replace(query.building || 'all', scopedVars, 'csv'),
      metric: srv.replace(query.metric || 'temperature', scopedVars),
      alias: query.alias ? srv.replace(query.alias, scopedVars) : undefined,
    };
  }

  query(options: DataQueryRequest<CampusQuery>): Observable<DataQueryResponse> {
    const from = options.range.from.valueOf();
    const to = options.range.to.valueOf();

    const targets = options.targets
      .filter((t) => this.filterQuery(t))
      .map((t) => this.applyTemplateVariables({ ...DEFAULT_QUERY, ...t } as CampusQuery, options.scopedVars));

    if (targets.length === 0) {
      return of({ data: [] });
    }

    // Each query becomes its own stream, so one failing query does not hide the others
    // and live queries can keep emitting after the normal ones have finished.
    const streams = targets.map((t) => {
      const fail = (err: unknown) =>
        of<DataQueryResponse>({
          key: t.refId,
          data: [],
          state: LoadingState.Error,
          errors: [{ refId: t.refId, message: describeError(err, this.apiUrl) }],
        });

      if (t.live && t.format !== 'table') {
        if (!this.wsUrl) {
          return fail(new Error('Live mode needs a WebSocket URL in the data source settings.'));
        }
        return fromPromise(this.fetchSeries(t, from, to)).pipe(
          mergeMap((history) => liveStream({ wsUrl: this.wsUrl!, query: t, history, windowMs: to - from })),
          catchError(fail)
        );
      }
      return fromPromise(this.runQuery(t, from, to)).pipe(
        map((data): DataQueryResponse => ({ key: t.refId, data, state: LoadingState.Done })),
        catchError(fail)
      );
    });

    return merge(...streams);
  }

  private fetchSeries(query: CampusQuery, from: number, to: number): Promise<ApiSeriesResponse> {
    return this.get<ApiSeriesResponse>('/series', {
      metric: query.metric,
      building: query.building,
      from: String(from),
      to: String(to),
      interval: query.interval || 'auto',
      agg: query.aggregation || 'avg',
      ...(query.includeTruth ? { truth: '1' } : {}),
    });
  }

  private async runQuery(query: CampusQuery, from: number, to: number): Promise<DataFrame[]> {
    if (query.format === 'table') {
      const res = await this.get<ApiSummaryResponse>('/summary', {
        metric: query.metric,
        building: query.building,
        from: String(from),
        to: String(to),
        interval: query.interval || 'auto',
      });
      return [summaryToFrame(res, query)];
    }
    return seriesToFrames(await this.fetchSeries(query, from, to), query);
  }

  /** GET through the Grafana data proxy. Throws the FetchError on non-2xx. */
  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const response = await lastValueFrom(
      getBackendSrv().fetch<T>({
        url: `${this.proxyUrl}${path}`,
        params,
        method: 'GET',
        showErrorAlert: false,
      })
    );
    return response.data;
  }

  /** Used by dashboard variables: query `buildings` or `metrics`. */
  async metricFindQuery(query: string): Promise<MetricFindValue[]> {
    const kind = (query || 'buildings').trim().toLowerCase();
    if (kind !== 'buildings' && kind !== 'metrics') {
      throw new Error('Variable query must be "buildings" or "metrics".');
    }
    const items = await this.get<ApiOption[]>(`/${kind}`);
    return items.map((i) => ({ text: i.name, value: i.id }));
  }

  async getBuildings(): Promise<ApiOption[]> {
    return this.get<ApiOption[]>('/buildings');
  }

  async getMetrics(): Promise<ApiOption[]> {
    return this.get<ApiOption[]>('/metrics');
  }

  /** "Save & test" button: checks that the API is reachable and that the key is accepted. */
  async testDatasource(): Promise<TestDataSourceResponse> {
    if (!this.apiUrl) {
      return { status: 'error', message: 'Please enter the API URL, e.g. http://campus-api:8080/api' };
    }
    try {
      const health = await this.get<{ status: string; version: string; developer: string }>('/health');
      const buildings = await this.getBuildings(); // needs the API key when the API requires one
      return {
        status: 'success',
        message: `Connected to Campus Sensor API v${health.version} (${buildings.length} buildings). Developed by Zeynep Sudem.`,
      };
    } catch (err) {
      return { status: 'error', message: describeError(err, this.apiUrl) };
    }
  }
}
