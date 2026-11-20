import React from 'react';
import { render, screen } from '@testing-library/react';
import { createTheme, dateTime, FieldType, LoadingState, PanelData, toDataFrame } from '@grafana/data';
import { InsightPanel, CREDIT } from './InsightPanel';
import { InsightOptions } from '../types';

// @grafana/ui is very large and slow to transform in Jest; the panel only needs the theme hooks.
jest.mock('@grafana/ui', () => {
  const { createTheme: makeTheme } = jest.requireActual('@grafana/data');
  const theme = makeTheme();
  return { useTheme2: () => theme, useStyles2: (fn: (t: unknown) => unknown) => fn(theme) };
});
void createTheme;

const from = dateTime(Date.UTC(2026, 10, 20, 0, 0));
const to = dateTime(Date.UTC(2026, 10, 20, 6, 0));
const timeRange = { from, to, raw: { from: 'now-6h', to: 'now' } };

const options: InsightOptions = {
  displayMode: 'line',
  lineColor: 'purple',
  lineWidth: 2,
  showStats: true,
  showGrid: true,
  threshold: 25,
  aiEnabled: false,
};

function panelData(values: number[], extra: Partial<PanelData> = {}): PanelData {
  const step = (to.valueOf() - from.valueOf()) / (values.length - 1 || 1);
  return {
    state: LoadingState.Done,
    timeRange,
    series: values.length
      ? [
          toDataFrame({
            fields: [
              { name: 'time', type: FieldType.time, values: values.map((_, i) => from.valueOf() + i * step) },
              { name: 'temperature', type: FieldType.number, values },
            ],
          }),
        ]
      : [],
    ...extra,
  };
}

function renderPanel(data: PanelData, opts: Partial<InsightOptions> = {}, size = { width: 800, height: 400 }) {
  const props = {
    id: 1,
    data,
    timeRange,
    timeZone: 'utc',
    options: { ...options, ...opts },
    transparent: false,
    width: size.width,
    height: size.height,
    fieldConfig: { defaults: {}, overrides: [] },
    renderCounter: 0,
    title: 'Test',
    eventBus: {} as any,
    onOptionsChange: jest.fn(),
    onFieldConfigChange: jest.fn(),
    replaceVariables: (s: string) => s,
    onChangeTimeRange: jest.fn(),
  };
  return render(<InsightPanel {...(props as any)} />);
}

describe('InsightPanel', () => {
  it('always shows the developer credit', () => {
    renderPanel(panelData([20, 21, 22]));
    expect(screen.getByText(CREDIT)).toBeInTheDocument();
    expect(CREDIT).toContain('Zeynep Sudem');
  });

  it('draws the series, stats and threshold', () => {
    renderPanel(panelData([20, 30, 22]));
    expect(screen.getAllByTestId('insight-series')).toHaveLength(1);
    expect(screen.getByTestId('insight-stats')).toHaveTextContent('Max30');
    expect(screen.getByTestId('insight-threshold')).toBeInTheDocument();
    expect(screen.getByTestId('insight-stats')).toHaveTextContent('Above threshold1 pts');
  });

  it('hides stats in compact mode (small panels)', () => {
    renderPanel(panelData([20, 30, 22]), {}, { width: 250, height: 150 });
    expect(screen.queryByTestId('insight-stats')).not.toBeInTheDocument();
    expect(screen.getByText(CREDIT)).toBeInTheDocument();
  });

  it('shows the query error message when there is no data', () => {
    renderPanel(panelData([], { errors: [{ message: 'Campus API is unreachable' }] }));
    expect(screen.getByTestId('insight-empty')).toHaveTextContent('Campus API is unreachable');
  });

  it('shows a LIVE badge while streaming', () => {
    renderPanel(panelData([20, 21, 22], { state: LoadingState.Streaming }));
    expect(screen.getByTestId('insight-live')).toBeInTheDocument();
  });
});
