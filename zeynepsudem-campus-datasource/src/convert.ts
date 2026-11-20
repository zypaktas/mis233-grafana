import { createDataFrame, DataFrame, FieldDTO, FieldType } from '@grafana/data';
import { ApiSeriesResponse, ApiSummaryResponse, CampusQuery } from './types';

/** Applies the alias template, e.g. "{{building}} – {{metric}}". */
export function applyAlias(alias: string | undefined, building: string, metric: string): string | undefined {
  if (!alias) {
    return undefined;
  }
  return alias.replace(/\{\{\s*building\s*\}\}/g, building).replace(/\{\{\s*metric\s*\}\}/g, metric);
}

/** One data frame per building: [Time, <metric>] with the right unit. */
export const TRUTH_FIELD = 'anomaly_truth';

export function seriesToFrames(res: ApiSeriesResponse, query: CampusQuery): DataFrame[] {
  return res.series.map((s) => {
    const fields: FieldDTO[] = [
      { name: 'Time', type: FieldType.time, values: s.points.map((p) => p[0]) },
      {
        name: res.metric,
        type: FieldType.number,
        values: s.points.map((p) => p[1]),
        labels: { building: s.building },
        config: {
          unit: res.unit,
          displayNameFromDS: applyAlias(query.alias, s.name, res.metric) ?? s.name,
        },
      },
    ];
    // Ground-truth labels (only when the query asked for them). Hidden in core panels.
    if (s.points.length > 0 && s.points.every((p) => p.length === 3)) {
      fields.push({
        name: TRUTH_FIELD,
        type: FieldType.number,
        values: s.points.map((p) => p[2] ?? 0),
        config: { custom: { hideFrom: { viz: true, legend: true, tooltip: false } } },
      });
    }
    return createDataFrame({ refId: query.refId, name: s.name, meta: { preferredVisualisationType: 'graph' }, fields });
  });
}

/** One table frame with a row per building. */
export function summaryToFrame(res: ApiSummaryResponse, query: CampusQuery): DataFrame {
  const unitConfig = { unit: res.unit, decimals: 2 };
  return createDataFrame({
    refId: query.refId,
    name: `${res.metric} summary`,
    meta: { preferredVisualisationType: 'table' },
    fields: [
      { name: 'Building', type: FieldType.string, values: res.rows.map((r) => r.building) },
      { name: 'Last', type: FieldType.number, values: res.rows.map((r) => r.last), config: unitConfig },
      { name: 'Min', type: FieldType.number, values: res.rows.map((r) => r.min), config: unitConfig },
      { name: 'Max', type: FieldType.number, values: res.rows.map((r) => r.max), config: unitConfig },
      { name: 'Average', type: FieldType.number, values: res.rows.map((r) => r.avg), config: unitConfig },
      {
        name: 'Change vs avg',
        type: FieldType.number,
        values: res.rows.map((r) => r.change_pct),
        config: { unit: 'percent', decimals: 1 },
      },
      { name: 'Samples', type: FieldType.number, values: res.rows.map((r) => r.samples) },
    ],
  });
}

/** Turns any thrown fetch / network error into one readable sentence. */
export function describeError(err: unknown, apiUrl?: string): string {
  const e = err as {
    status?: number;
    statusText?: string;
    data?: { error?: string; message?: string };
    message?: string;
  };
  const where = apiUrl ? ` (${apiUrl})` : '';
  if (e?.status === 502 || e?.status === 503 || e?.status === 504) {
    return `Campus API is unreachable${where}. Is the campus-api container running? (HTTP ${e.status})`;
  }
  if (e?.data?.error) {
    return `Campus API error${e.status ? ' ' + e.status : ''}: ${e.data.error}`;
  }
  if (e?.status === 401 || e?.status === 403) {
    return `Campus API rejected the request (HTTP ${e.status}). Check the API key in the data source settings.`;
  }
  if (e?.status) {
    return `Campus API request failed: HTTP ${e.status}${e.statusText ? ' ' + e.statusText : ''}${e?.data?.message ? ' – ' + e.data.message : ''}`;
  }
  return `Campus API request failed${where}: ${e?.message ?? String(err)}`;
}
