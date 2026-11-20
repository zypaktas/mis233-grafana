import { PanelPlugin } from '@grafana/data';
import { HeatmapOptions } from './types';
import { HeatmapPanel } from './components/HeatmapPanel';

export const plugin = new PanelPlugin<HeatmapOptions>(HeatmapPanel).setPanelOptions((builder) =>
  builder
    .addRadio({
      path: 'colorScheme',
      name: 'Colour scheme',
      defaultValue: 'heat',
      settings: {
        options: [
          { value: 'heat', label: 'Heat' },
          { value: 'cool', label: 'Cool' },
          { value: 'diverging', label: 'Diverging' },
        ],
      },
    })
    .addSliderInput({
      path: 'buckets',
      name: 'Time columns',
      description: '0 = automatic (fits the panel width)',
      defaultValue: 0,
      settings: { min: 0, max: 96, step: 1 },
    })
    .addBooleanSwitch({ path: 'showValues', name: 'Show values in cells', defaultValue: true })
    .addTextInput({
      path: 'variableName',
      name: 'Drill-down variable',
      description:
        'Clicking a row label sets this dashboard variable to the building id (e.g. "building"). Empty = off',
      defaultValue: 'building',
    })
);
