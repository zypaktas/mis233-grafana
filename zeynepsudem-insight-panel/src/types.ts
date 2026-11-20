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

  // ----- Insight AI -----
  /** Train the in-browser model and draw forecast + anomalies. */
  aiEnabled?: boolean;
  /** Number of future points to forecast. */
  aiHorizon?: number;
  /** Robust z-score above which a point counts as an anomaly. */
  aiSensitivity?: number;
  /** Show the plain-language AI summary above the chart. */
  aiShowSummary?: boolean;
  /** Which series the AI analyses (part of its name). Empty = first visible series. */
  aiSeries?: string;
}
