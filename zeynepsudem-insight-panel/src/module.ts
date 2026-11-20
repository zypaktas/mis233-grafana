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
    });
});
