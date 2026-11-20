import React from 'react';
import { Field, Input, SecretInput, Stack, Text } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { CampusOptions, CampusSecureOptions } from '../types';

interface Props extends DataSourcePluginOptionsEditorProps<CampusOptions, CampusSecureOptions> {}

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const { jsonData, secureJsonFields, secureJsonData } = options;

  const setJson = (patch: Partial<CampusOptions>) =>
    onOptionsChange({ ...options, jsonData: { ...jsonData, ...patch } });

  return (
    <Stack direction="column" gap={2}>
      <Text element="h3">Campus Sensor API</Text>
      <Text color="secondary">
        Developed by Zeynep Sudem · MIS 233. REST calls go through the Grafana server (data proxy), so the API key is
        never sent to the browser.
      </Text>
      <Field label="API URL" description="Base URL of the REST API as seen from the Grafana server" required>
        <Input
          id="config-api-url"
          width={50}
          value={jsonData.apiUrl ?? ''}
          placeholder="http://campus-api:8080/api"
          onChange={(e) => setJson({ apiUrl: e.currentTarget.value })}
        />
      </Field>
      <Field label="WebSocket URL" description="Live stream URL as seen from your browser (used by live queries)">
        <Input
          id="config-ws-url"
          width={50}
          value={jsonData.wsUrl ?? ''}
          placeholder="ws://localhost:8080/live"
          onChange={(e) => setJson({ wsUrl: e.currentTarget.value })}
        />
      </Field>
      <Field label="API key" description="Optional. Sent as the X-API-Key header by the Grafana server">
        <SecretInput
          id="config-api-key"
          width={50}
          isConfigured={!!secureJsonFields?.apiKey}
          value={secureJsonData?.apiKey ?? ''}
          placeholder="secret"
          onReset={() =>
            onOptionsChange({
              ...options,
              secureJsonFields: { ...secureJsonFields, apiKey: false },
              secureJsonData: { ...secureJsonData, apiKey: '' },
            })
          }
          onChange={(e) => onOptionsChange({ ...options, secureJsonData: { apiKey: e.currentTarget.value } })}
        />
      </Field>
    </Stack>
  );
}
