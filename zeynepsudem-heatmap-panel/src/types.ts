export type ColorScheme = 'heat' | 'cool' | 'diverging';

export interface HeatmapOptions {
  /** Number of time columns. 0 = automatic (about one per 18 px). */
  buckets: number;
  colorScheme: ColorScheme;
  /** Print the value inside each cell when there is room. */
  showValues: boolean;
  /** Clicking a row sets this dashboard variable to the row's building id. Empty = off. */
  variableName: string;
}
