import React, { useEffect, useState } from 'react';
import {
  Alert,
  Combobox,
  ComboboxOption,
  InlineField,
  InlineSwitch,
  Input,
  RadioButtonGroup,
  Stack,
  Text,
} from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { DataSource } from '../datasource';
import { Aggregation, CampusOptions, CampusQuery, DEFAULT_QUERY, QueryFormat } from '../types';
import { describeError } from '../convert';

type Props = QueryEditorProps<DataSource, CampusQuery, CampusOptions>;

const AGGREGATIONS: Array<ComboboxOption<Aggregation>> = [
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'last', label: 'Last' },
];

const INTERVALS: Array<ComboboxOption<string>> = ['auto', '1m', '5m', '15m', '30m', '1h', '6h'].map((v) => ({
  value: v,
  label: v,
}));

const FORMATS: Array<{ value: QueryFormat; label: string; description: string }> = [
  { value: 'timeseries', label: 'Time series', description: 'One series per building' },
  { value: 'table', label: 'Table', description: 'One row per building with min / max / avg' },
];

export function QueryEditor({ query, onChange, onRunQuery, datasource }: Props) {
  const q = { ...DEFAULT_QUERY, ...query } as CampusQuery;
  const [buildings, setBuildings] = useState<Array<ComboboxOption<string>>>([]);
  const [metrics, setMetrics] = useState<Array<ComboboxOption<string>>>([]);
  const [loadError, setLoadError] = useState<string>();

  // Load the building / metric lists from the API once.
  useEffect(() => {
    let cancelled = false;
    Promise.all([datasource.getBuildings(), datasource.getMetrics()])
      .then(([b, m]) => {
        if (cancelled) {
          return;
        }
        const variables = getTemplateSrv()
          .getVariables()
          .map((v) => ({ value: `$${v.name}`, label: `$${v.name}`, description: 'Dashboard variable' }));
        setBuildings([
          { value: 'all', label: 'All buildings' },
          ...b.map((x) => ({ value: x.id, label: x.name })),
          ...variables,
        ]);
        setMetrics([...m.map((x) => ({ value: x.id, label: x.name, description: x.unit })), ...variables]);
        setLoadError(undefined);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(describeError(err, datasource.apiUrl));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasource]);

  const update = (patch: Partial<CampusQuery>, run = true) => {
    onChange({ ...q, ...patch });
    if (run) {
      onRunQuery();
    }
  };

  return (
    <Stack direction="column" gap={1}>
      {loadError && (
        <Alert title="Could not load buildings / metrics" severity="error">
          {loadError}
        </Alert>
      )}
      <Stack gap={1} wrap="wrap">
        <InlineField label="Building" labelWidth={12} tooltip="One building, all buildings, or a dashboard variable">
          <Combobox
            width={28}
            options={buildings}
            value={q.building}
            createCustomValue
            onChange={(o) => update({ building: o.value })}
            data-testid="campus-building"
          />
        </InlineField>
        <InlineField label="Metric" labelWidth={10}>
          <Combobox
            width={22}
            options={metrics}
            value={q.metric}
            createCustomValue
            onChange={(o) => update({ metric: o.value })}
          />
        </InlineField>
        <InlineField label="Format" labelWidth={10}>
          <RadioButtonGroup options={FORMATS} value={q.format} onChange={(v) => update({ format: v })} />
        </InlineField>
      </Stack>
      <Stack gap={1} wrap="wrap">
        <InlineField
          label="Aggregation"
          labelWidth={12}
          tooltip="How the 1-minute samples inside each interval are combined"
          disabled={q.format === 'table'}
        >
          <Combobox
            width={16}
            options={AGGREGATIONS}
            value={q.aggregation}
            onChange={(o) => update({ aggregation: o.value })}
          />
        </InlineField>
        <InlineField
          label="Interval"
          labelWidth={10}
          tooltip="Distance between points. auto ≈ 300 points for the range"
        >
          <Combobox
            width={12}
            options={INTERVALS}
            value={q.interval}
            createCustomValue
            onChange={(o) => update({ interval: o.value })}
          />
        </InlineField>
        <InlineField
          label="Alias"
          labelWidth={10}
          tooltip="Legend name. {{building}} and {{metric}} are replaced"
          disabled={q.format === 'table'}
        >
          <Input
            width={26}
            value={q.alias ?? ''}
            placeholder="{{building}} {{metric}}"
            onChange={(e) => update({ alias: e.currentTarget.value }, false)}
            onBlur={() => onRunQuery()}
          />
        </InlineField>
      </Stack>
      <Stack gap={1}>
        <InlineField
          label="Live (WebSocket)"
          labelWidth={18}
          tooltip="Loads the history over REST, then streams one new point per second over WebSocket"
          disabled={q.format === 'table'}
        >
          <InlineSwitch value={!!q.live} onChange={(e) => update({ live: e.currentTarget.checked })} />
        </InlineField>
        <InlineField
          label="Ground-truth labels"
          labelWidth={20}
          tooltip="Adds the API's injected-anomaly labels (anomaly_truth field), used by the Insight panel to score its AI"
          disabled={q.format === 'table'}
        >
          <InlineSwitch value={!!q.includeTruth} onChange={(e) => update({ includeTruth: e.currentTarget.checked })} />
        </InlineField>
      </Stack>
      <Text variant="bodySmall" color="secondary">
        Campus Sensors data source · Developed by Zeynep Sudem
      </Text>
    </Stack>
  );
}
