import { getBackendSrv, getTemplateSrv } from '@grafana/runtime';
import {
  CoreApp,
  DataFrame,
  DataQueryError,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  MetricFindValue,
  ScopedVars,
  TestDataSourceResponse,
} from '@grafana/data';
import { lastValueFrom } from 'rxjs';

import {
  ApiOption,
  ApiSeriesResponse,
  ApiSummaryResponse,
  CampusOptions,
  CampusQuery,
  DEFAULT_QUERY,
} from './types';
import { describeError, seriesToFrames, summaryToFrame } from './convert';

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

  async query(options: DataQueryRequest<CampusQuery>): Promise<DataQueryResponse> {
    const from = options.range.from.valueOf();
    const to = options.range.to.valueOf();

    const targets = options.targets
      .filter((t) => this.filterQuery(t))
      .map((t) => this.applyTemplateVariables({ ...DEFAULT_QUERY, ...t } as CampusQuery, options.scopedVars));

    // Run all queries in parallel; one failing query must not hide the others.
    const results = await Promise.allSettled(targets.map((t) => this.runQuery(t, from, to)));

    const data: DataFrame[] = [];
    const errors: DataQueryError[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        data.push(...r.value);
      } else {
        errors.push({ refId: targets[i].refId, message: describeError(r.reason, this.apiUrl) });
      }
    });

    return { data, errors: errors.length ? errors : undefined };
  }

  private async runQuery(query: CampusQuery, from: number, to: number): Promise<DataFrame[]> {
    const params = {
      metric: query.metric,
      building: query.building,
      from: String(from),
      to: String(to),
      interval: query.interval || 'auto',
    };
    if (query.format === 'table') {
      const res = await this.get<ApiSummaryResponse>('/summary', params);
      return [summaryToFrame(res, query)];
    }
    const res = await this.get<ApiSeriesResponse>('/series', { ...params, agg: query.aggregation || 'avg' });
    return seriesToFrames(res, query);
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
