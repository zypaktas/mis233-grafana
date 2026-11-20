import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export type QueryFormat = 'timeseries' | 'table';
export type Aggregation = 'avg' | 'min' | 'max' | 'last';

export interface CampusQuery extends DataQuery {
  /** Building id, a comma separated list, `all`, or a dashboard variable like `$building`. */
  building: string;
  /** temperature | humidity | energy | occupancy */
  metric: string;
  aggregation: Aggregation;
  /** `auto` or e.g. `1m`, `5m`, `1h`. */
  interval: string;
  format: QueryFormat;
  /** Optional legend override. `{{building}}` and `{{metric}}` are replaced. */
  alias?: string;
  /** Stream new points over WebSocket (time series only). */
  live?: boolean;
}

export const DEFAULT_QUERY: Partial<CampusQuery> = {
  building: 'all',
  metric: 'temperature',
  aggregation: 'avg',
  interval: 'auto',
  format: 'timeseries',
  live: false,
};

/** Options saved per data source instance. */
export interface CampusOptions extends DataSourceJsonData {
  /** REST base URL as seen from the Grafana server, e.g. http://campus-api:8080/api */
  apiUrl?: string;
  /** WebSocket URL as seen from the browser, e.g. ws://localhost:8080/live */
  wsUrl?: string;
}

/** Secrets: only stored on the server and injected by the Grafana data proxy. */
export interface CampusSecureOptions {
  apiKey?: string;
}

// ----- REST API response shapes -----

export interface ApiSeriesResponse {
  metric: string;
  unit: string;
  interval_ms: number;
  aggregation: Aggregation;
  series: Array<{ building: string; name: string; points: Array<[number, number]> }>;
}

export interface ApiSummaryResponse {
  metric: string;
  unit: string;
  rows: Array<{
    building: string;
    last: number;
    min: number;
    max: number;
    avg: number;
    change_pct: number;
    samples: number;
  }>;
}

export interface ApiOption {
  id: string;
  name: string;
  unit?: string;
}
