export type DisplayMode = 'line' | 'area' | 'points';

export interface InsightOptions {
  /** How the series are drawn. */
  displayMode: DisplayMode;
  /** Colour of the first series (other series use the theme palette). */
  lineColor: string;
  /** Stroke width in pixels. */
  lineWidth: number;
  /** Show the min / max / mean / last strip above the chart. */
  showStats: boolean;
  /** Draw horizontal grid lines. */
  showGrid: boolean;
  /** Optional alert threshold. Points above it are highlighted. */
  threshold?: number;
}
