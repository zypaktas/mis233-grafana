import { PanelPlugin } from '@grafana/data';
import { InsightOptions } from './types';
import { InsightPanel } from './components/InsightPanel';

export const plugin = new PanelPlugin<InsightOptions>(InsightPanel).setPanelOptions((builder) => {
  return builder
    .addRadio({
      path: 'displayMode',
      name: 'Display mode',
      description: 'How the series are drawn',
      defaultValue: 'area',
      category: ['Insight'],
      settings: {
        options: [
          { value: 'line', label: 'Line' },
          { value: 'area', label: 'Area' },
          { value: 'points', label: 'Points' },
        ],
      },
    })
    .addColorPicker({
      path: 'lineColor',
      name: 'Main colour',
      description: 'Colour of the first series',
      defaultValue: 'purple',
      category: ['Insight'],
    })
    .addSliderInput({
      path: 'lineWidth',
      name: 'Line width',
      defaultValue: 2,
      category: ['Insight'],
      settings: { min: 1, max: 6, step: 1 },
    })
    .addBooleanSwitch({
      path: 'showStats',
      name: 'Show stats strip',
      description: 'Last / min / mean / max of the first series',
      defaultValue: true,
      category: ['Insight'],
    })
    .addBooleanSwitch({
      path: 'showGrid',
      name: 'Show grid',
      defaultValue: true,
      category: ['Insight'],
    })
    .addNumberInput({
      path: 'threshold',
      name: 'Threshold',
      description: 'Points above this value are highlighted in red. Leave empty to disable.',
      category: ['Insight'],
    })
    .addBooleanSwitch({
      path: 'aiEnabled',
      name: 'Enable Insight AI',
      description: 'Trains a small neural network in your browser on this data: forecast + anomaly detection',
      defaultValue: true,
      category: ['Insight AI'],
    })
    .addSliderInput({
      path: 'aiHorizon',
      name: 'Forecast horizon (points)',
      defaultValue: 24,
      category: ['Insight AI'],
      settings: { min: 0, max: 120, step: 1 },
      showIf: (o) => o.aiEnabled !== false,
    })
    .addSliderInput({
      path: 'aiSensitivity',
      name: 'Anomaly threshold (σ)',
      description: 'Lower = more points flagged. Robust z-score of the prediction error',
      defaultValue: 3.5,
      category: ['Insight AI'],
      settings: { min: 2, max: 6, step: 0.5 },
      showIf: (o) => o.aiEnabled !== false,
    })
    .addBooleanSwitch({
      path: 'aiShowSummary',
      name: 'Show AI summary',
      defaultValue: true,
      category: ['Insight AI'],
      showIf: (o) => o.aiEnabled !== false,
    })
    .addTextInput({
      path: 'aiSeries',
      name: 'Series to analyse',
      description: 'Part of the series name, e.g. "Library". Empty = first visible series',
      defaultValue: '',
      category: ['Insight AI'],
      showIf: (o) => o.aiEnabled !== false,
    });
});
