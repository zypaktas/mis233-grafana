import React, { useMemo, useRef, useState } from 'react';
import { dateTimeFormat, GrafanaTheme2, LoadingState, PanelProps } from '@grafana/data';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { InsightOptions } from '../types';
import { computeStats, formatValue, framesToSeries, nearestIndex, niceTicks, Point, Series } from '../utils/series';
import { useInsightAI } from '../ai/useInsightAI';
import { summarize } from '../ai/insight';

interface Props extends PanelProps<InsightOptions> {}

/** Below these sizes the panel switches to a compact layout (no axes, no stats strip). */
const COMPACT_WIDTH = 320;
const COMPACT_HEIGHT = 170;
const DRAG_THRESHOLD_PX = 6;

export const CREDIT = 'Developed by Zeynep Sudem · MIS 233 · Fall 2026';

export const InsightPanel: React.FC<Props> = ({
  options,
  data,
  width,
  height,
  timeRange,
  timeZone,
  onChangeTimeRange,
}) => {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const svgRef = useRef<SVGSVGElement>(null);

  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [pinned, setPinned] = useState<{ series: string; point: Point } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const allSeries = useMemo(() => framesToSeries(data.series), [data.series]);
  const visible = allSeries.filter((s) => !hidden.has(s.name));

  const compact = width < COMPACT_WIDTH || height < COMPACT_HEIGHT;
  const showStats = options.showStats && !compact;
  const statsHeight = showStats ? 40 : 0;

  // ----- AI: forecast + anomaly detection on one series, trained in the browser -----
  const streaming = data.state === LoadingState.Streaming;
  const aiEnabled = options.aiEnabled ?? true;
  const aiTarget =
    visible.find((s) => options.aiSeries && s.name.toLowerCase().includes(options.aiSeries.toLowerCase())) ??
    visible[0];
  const ai = useInsightAI(aiTarget, aiEnabled, options.aiHorizon ?? 24, options.aiSensitivity ?? 3.5, streaming);
  const aiResult = aiEnabled && ai.seriesName === aiTarget?.name ? ai.result : undefined;
  const aiColor = theme.colors.warning.main;
  const showAiSummary = aiEnabled && (options.aiShowSummary ?? true) && !compact && height > 260;
  const aiLines = showAiSummary
    ? aiResult && aiTarget
      ? summarize(
          aiTarget.name,
          aiTarget.points,
          aiResult,
          formatValue,
          (t) => dateTimeFormat(t, { format: 'MMM D HH:mm', timeZone }),
          options.aiSensitivity ?? 3.5
        )
      : ai.error
        ? [ai.error]
        : []
    : [];
  const aiHeight = aiLines.length ? aiLines.length * 16 + 10 : 0;

  const legendHeight = allSeries.length > 1 && !compact ? 22 : 0;
  const footerHeight = 18;
  const chartHeight = Math.max(20, height - statsHeight - aiHeight - legendHeight - footerHeight);
  const margin = compact ? { top: 6, right: 6, bottom: 6, left: 6 } : { top: 8, right: 12, bottom: 22, left: 48 };
  const innerW = Math.max(10, width - margin.left - margin.right);
  const innerH = Math.max(10, chartHeight - margin.top - margin.bottom);

  const colorFor = (index: number) =>
    index === 0
      ? theme.visualization.getColorByName(options.lineColor)
      : theme.visualization.getColorByName(theme.visualization.palette[index % theme.visualization.palette.length]);

  // ----- scales -----
  // While a live (streaming) query runs, slide the window so the newest point stays at the right edge.
  let tMin = timeRange.from.valueOf();
  let tMax = timeRange.to.valueOf();
  if (streaming) {
    const lastT = Math.max(...allSeries.map((s) => s.points[s.points.length - 1].t));
    if (lastT > tMax) {
      tMin += lastT - tMax;
      tMax = lastT;
    }
  }
  // Make room on the right for the AI forecast.
  const dataEnd = tMax;
  const forecast = aiResult?.forecast ?? [];
  if (forecast.length > 0) {
    tMax = Math.max(tMax, forecast[forecast.length - 1].t);
  }
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const f of forecast) {
    vMin = Math.min(vMin, f.lo);
    vMax = Math.max(vMax, f.hi);
  }
  for (const s of visible) {
    for (const p of s.points) {
      if (p.t < tMin || p.t > tMax) {
        continue;
      }
      vMin = Math.min(vMin, p.v);
      vMax = Math.max(vMax, p.v);
    }
  }
  if (options.threshold !== undefined && options.threshold !== null && Number.isFinite(options.threshold)) {
    vMin = Math.min(vMin, options.threshold);
    vMax = Math.max(vMax, options.threshold);
  }
  if (!Number.isFinite(vMin)) {
    vMin = 0;
    vMax = 1;
  }
  const pad = (vMax - vMin) * 0.08 || Math.abs(vMax) * 0.1 || 1;
  vMin -= pad;
  vMax += pad;

  const x = (t: number) => ((t - tMin) / (tMax - tMin || 1)) * innerW;
  const y = (v: number) => innerH - ((v - vMin) / (vMax - vMin)) * innerH;
  const tAt = (px: number) => tMin + (px / innerW) * (tMax - tMin);

  const yTicks = niceTicks(vMin, vMax, Math.max(2, Math.floor(innerH / 40)));
  const xTickCount = Math.max(2, Math.floor(innerW / 110));
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => tMin + ((tMax - tMin) * i) / xTickCount);
  const spanMs = tMax - tMin;
  const xFormat = spanMs > 2 * 86400000 ? 'MM/DD HH:mm' : spanMs > 3600000 ? 'HH:mm' : 'HH:mm:ss';
  const fmtTime = (t: number, f = 'YYYY-MM-DD HH:mm:ss') => dateTimeFormat(t, { format: f, timeZone });

  const threshold =
    options.threshold !== undefined && options.threshold !== null && Number.isFinite(options.threshold)
      ? options.threshold
      : undefined;

  // ----- mouse handling (hover tooltip, click to pin, drag to zoom) -----
  const localX = (e: React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return Math.min(innerW, Math.max(0, e.clientX - rect.left - margin.left));
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const endX = localX(e);
    if (dragStartX !== null && Math.abs(endX - dragStartX) > DRAG_THRESHOLD_PX) {
      const [a, b] = [Math.min(dragStartX, endX), Math.max(dragStartX, endX)];
      onChangeTimeRange({ from: tAt(a), to: tAt(b) });
    } else if (hoverX !== null) {
      // Click: pin the nearest point of the first visible series, or unpin.
      const hit = closestPoint(visible, tAt(hoverX));
      if (hit && (!pinned || pinned.point.t !== hit.point.t || pinned.series !== hit.series)) {
        setPinned(hit);
      } else {
        setPinned(null);
      }
    }
    setDragStartX(null);
  };

  const toggleSeries = (name: string) => {
    const next = new Set(hidden);
    next.has(name) ? next.delete(name) : next.add(name);
    setHidden(next);
  };

  const hoverT = hoverX !== null ? tAt(hoverX) : null;
  const hoverRows =
    hoverT !== null
      ? visible
          .map((s) => {
            const i = nearestIndex(s.points, hoverT);
            return i >= 0 ? { name: s.name, color: colorFor(allSeries.indexOf(s)), point: s.points[i] } : null;
          })
          .filter((r): r is { name: string; color: string; point: Point } => r !== null)
      : [];

  const mainStats = visible.length > 0 ? computeStats(visible[0].points) : undefined;
  const pinnedAnomaly =
    pinned && pinned.series === aiTarget?.name ? aiResult?.anomalies.find((a) => a.t === pinned.point.t) : undefined;

  const errorText = (data.errors ?? [])
    .map((e) => e.message)
    .filter(Boolean)
    .join(' · ');

  if (allSeries.length === 0) {
    return (
      <div className={styles.wrapper} style={{ width, height }}>
        <div className={styles.empty} data-testid="insight-empty">
          {errorText ? (
            <span className={styles.errorText}>⚠ {errorText}</span>
          ) : (
            'No time series data. Add a query that returns a time field and a number field.'
          )}
        </div>
        <div className={styles.footer} data-testid="developer-credit">
          {CREDIT}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper} style={{ width, height }}>
      {showStats && mainStats && (
        <div className={styles.stats} data-testid="insight-stats">
          <Stat label="Last" value={mainStats.last} />
          <Stat label="Min" value={mainStats.min} />
          <Stat label="Mean" value={mainStats.mean} />
          <Stat label="Max" value={mainStats.max} />
          {threshold !== undefined && (
            <Stat
              label="Above threshold"
              text={`${countAbove(visible, threshold)} pts`}
              warn={countAbove(visible, threshold) > 0}
            />
          )}
        </div>
      )}

      {aiLines.length > 0 && (
        <div className={styles.aiBox} style={{ height: aiHeight }} data-testid="insight-ai-summary">
          {aiLines.map((line) => (
            <div key={line} className={styles.aiLine} title={line}>
              🤖 {line}
            </div>
          ))}
        </div>
      )}

      <svg
        ref={svgRef}
        width={width}
        height={chartHeight}
        className={styles.svg}
        data-testid="insight-chart"
        onMouseMove={(e) => setHoverX(localX(e))}
        onMouseLeave={() => {
          setHoverX(null);
          setDragStartX(null);
        }}
        onMouseDown={(e) => setDragStartX(localX(e))}
        onMouseUp={onMouseUp}
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* grid + y axis */}
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              {options.showGrid && (
                <line x1={0} x2={innerW} y1={y(v)} y2={y(v)} stroke={theme.colors.border.weak} strokeWidth={1} />
              )}
              {!compact && (
                <text x={-6} y={y(v)} dy="0.32em" textAnchor="end" className={styles.axisText}>
                  {formatValue(v)}
                </text>
              )}
            </g>
          ))}
          {/* x axis */}
          {!compact &&
            xTicks.map((t, i) => (
              <text
                key={`x${t}`}
                x={x(t)}
                y={innerH + 15}
                textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                className={styles.axisText}
              >
                {fmtTime(t, xFormat)}
              </text>
            ))}

          {/* threshold */}
          {threshold !== undefined && (
            <line
              x1={0}
              x2={innerW}
              y1={y(threshold)}
              y2={y(threshold)}
              stroke={theme.colors.error.main}
              strokeDasharray="6 4"
              strokeWidth={1.5}
              data-testid="insight-threshold"
            />
          )}

          {/* series */}
          {visible.map((s) => {
            const color = colorFor(allSeries.indexOf(s));
            const pts = s.points.filter((p) => p.t >= tMin && p.t <= tMax);
            if (pts.length === 0) {
              return null;
            }
            const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
            const first = pts[0];
            const last = pts[pts.length - 1];
            return (
              <g key={s.name} data-testid="insight-series">
                {options.displayMode === 'area' && (
                  <path
                    d={`${path}L${x(last.t)},${innerH}L${x(first.t)},${innerH}Z`}
                    fill={color}
                    fillOpacity={0.18}
                    stroke="none"
                  />
                )}
                {options.displayMode !== 'points' && (
                  <path d={path} fill="none" stroke={color} strokeWidth={options.lineWidth} strokeLinejoin="round" />
                )}
                {(options.displayMode === 'points' || threshold !== undefined) &&
                  pts.map((p) => {
                    const over = threshold !== undefined && p.v > threshold;
                    if (options.displayMode !== 'points' && !over) {
                      return null;
                    }
                    return (
                      <circle
                        key={p.t}
                        cx={x(p.t)}
                        cy={y(p.v)}
                        r={over ? Math.max(3, options.lineWidth + 1) : Math.max(2, options.lineWidth)}
                        fill={over ? theme.colors.error.main : color}
                      />
                    );
                  })}
              </g>
            );
          })}

          {/* AI forecast: 95% band, dashed line, "now" divider */}
          {forecast.length > 0 && aiTarget && (
            <g pointerEvents="none" data-testid="insight-ai-forecast">
              <line
                x1={x(dataEnd)}
                x2={x(dataEnd)}
                y1={0}
                y2={innerH}
                stroke={theme.colors.border.medium}
                strokeDasharray="2 4"
              />
              <path
                d={
                  forecast.map((f, i) => `${i === 0 ? 'M' : 'L'}${x(f.t).toFixed(1)},${y(f.hi).toFixed(1)}`).join('') +
                  [...forecast]
                    .reverse()
                    .map((f) => `L${x(f.t).toFixed(1)},${y(f.lo).toFixed(1)}`)
                    .join('') +
                  'Z'
                }
                fill={aiColor}
                fillOpacity={0.13}
              />
              <path
                d={
                  `M${x(aiTarget.points[aiTarget.points.length - 1].t).toFixed(1)},${y(aiTarget.points[aiTarget.points.length - 1].v).toFixed(1)}` +
                  forecast.map((f) => `L${x(f.t).toFixed(1)},${y(f.v).toFixed(1)}`).join('')
                }
                fill="none"
                stroke={aiColor}
                strokeWidth={Math.max(1.5, options.lineWidth)}
                strokeDasharray="6 4"
              />
              {!compact && (
                <text x={x(dataEnd) + 4} y={10} className={styles.axisText} style={{ fill: aiColor }}>
                  AI forecast
                </text>
              )}
            </g>
          )}

          {/* AI anomalies */}
          {aiResult?.anomalies
            .filter((a) => a.t >= tMin && a.t <= tMax)
            .map((a) => (
              <g key={`an${a.t}`} pointerEvents="none" data-testid="insight-ai-anomaly">
                <circle cx={x(a.t)} cy={y(a.v)} r={6} fill="none" stroke={aiColor} strokeWidth={2} />
                <line x1={x(a.t)} x2={x(a.t)} y1={y(a.v)} y2={y(a.expected)} stroke={aiColor} strokeDasharray="2 2" />
              </g>
            ))}

          {/* drag-to-zoom selection */}
          {dragStartX !== null && hoverX !== null && Math.abs(hoverX - dragStartX) > DRAG_THRESHOLD_PX && (
            <rect
              x={Math.min(dragStartX, hoverX)}
              y={0}
              width={Math.abs(hoverX - dragStartX)}
              height={innerH}
              fill={theme.colors.primary.transparent}
              stroke={theme.colors.primary.border}
            />
          )}

          {/* hover crosshair */}
          {hoverX !== null && (
            <g pointerEvents="none">
              <line
                x1={hoverX}
                x2={hoverX}
                y1={0}
                y2={innerH}
                stroke={theme.colors.text.secondary}
                strokeDasharray="3 3"
              />
              {hoverRows.map((r) => (
                <circle
                  key={r.name}
                  cx={x(r.point.t)}
                  cy={y(r.point.v)}
                  r={4}
                  fill={r.color}
                  stroke={theme.colors.background.primary}
                />
              ))}
            </g>
          )}

          {/* pinned point */}
          {pinned && (
            <g pointerEvents="none" data-testid="insight-pinned">
              <circle
                cx={x(pinned.point.t)}
                cy={y(pinned.point.v)}
                r={7}
                fill="none"
                stroke={theme.colors.warning.main}
                strokeWidth={2}
              />
            </g>
          )}

          {/* invisible hit area so the whole plot reacts to the mouse */}
          <rect x={0} y={0} width={innerW} height={innerH} fill="transparent" style={{ cursor: 'crosshair' }} />
        </g>
      </svg>

      {hoverX !== null && hoverRows.length > 0 && dragStartX === null && (
        <div
          className={styles.tooltip}
          data-testid="insight-tooltip"
          style={{
            top: statsHeight + margin.top + 4,
            ...(hoverX + margin.left > width / 2
              ? { right: width - (hoverX + margin.left) + 12 }
              : { left: hoverX + margin.left + 12 }),
          }}
        >
          <div className={styles.tooltipTime}>{fmtTime(hoverRows[0].point.t)}</div>
          {hoverRows.map((r) => (
            <div key={r.name} className={styles.tooltipRow}>
              <span className={styles.swatch} style={{ background: r.color }} />
              <span className={styles.tooltipName}>{r.name}</span>
              <b>{formatValue(r.point.v)}</b>
            </div>
          ))}
          {hoverT !== null && hoverT > dataEnd && forecast.length > 0 && (
            <div className={styles.tooltipRow} style={{ color: aiColor }}>
              🤖 AI forecast {formatValue(forecast[nearestIndex(forecast, hoverT)].v)} (±
              {formatValue(
                (forecast[nearestIndex(forecast, hoverT)].hi - forecast[nearestIndex(forecast, hoverT)].lo) / 2
              )}
              )
            </div>
          )}
          <div className={styles.hint}>click: pin · drag: zoom</div>
        </div>
      )}

      {legendHeight > 0 && (
        <div className={styles.legend}>
          {allSeries.map((s, i) => (
            <button
              key={s.name}
              className={styles.legendItem}
              style={{ opacity: hidden.has(s.name) ? 0.4 : 1 }}
              onClick={() => toggleSeries(s.name)}
              title="Click to show / hide"
            >
              <span className={styles.swatch} style={{ background: colorFor(i) }} />
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className={styles.footer}>
        {pinned ? (
          <span data-testid="insight-pinned-info">
            📌 {pinned.series} = <b>{formatValue(pinned.point.v)}</b> at {fmtTime(pinned.point.t)}
            {mainStats &&
              ` (${pinned.point.v >= mainStats.mean ? '+' : ''}${formatValue(pinned.point.v - mainStats.mean)} vs mean)`}
            {pinnedAnomaly &&
              ` · 🤖 AI anomaly ${pinnedAnomaly.z > 0 ? '+' : ''}${pinnedAnomaly.z.toFixed(1)}σ, expected ≈ ${formatValue(pinnedAnomaly.expected)}`}
          </span>
        ) : (
          <span data-testid="developer-credit">
            {streaming && (
              <span className={styles.live} data-testid="insight-live">
                ● LIVE
              </span>
            )}
            {CREDIT}
          </span>
        )}
      </div>
    </div>
  );
};

function countAbove(series: Series[], threshold: number): number {
  return series.reduce((n, s) => n + s.points.filter((p) => p.v > threshold).length, 0);
}

function closestPoint(series: Series[], t: number): { series: string; point: Point } | null {
  if (series.length === 0) {
    return null;
  }
  const s = series[0];
  const i = nearestIndex(s.points, t);
  return i >= 0 ? { series: s.name, point: s.points[i] } : null;
}

const Stat: React.FC<{ label: string; value?: number; text?: string; warn?: boolean }> = ({
  label,
  value,
  text,
  warn,
}) => {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue} style={warn ? { color: 'var(--insight-warn)' } : undefined}>
        {text ?? formatValue(value ?? 0)}
      </div>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css`
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
    --insight-warn: ${theme.colors.error.text};
  `,
  svg: css`
    display: block;
    flex: none;
  `,
  axisText: css`
    fill: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  stats: css`
    display: flex;
    gap: ${theme.spacing(2)};
    height: 40px;
    padding: 0 ${theme.spacing(1)};
    overflow: hidden;
  `,
  stat: css`
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
  `,
  statLabel: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    white-space: nowrap;
  `,
  statValue: css`
    font-size: ${theme.typography.h5.fontSize};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  legend: css`
    display: flex;
    flex-wrap: wrap;
    gap: ${theme.spacing(1)};
    height: 22px;
    overflow: hidden;
    padding: 0 ${theme.spacing(1)};
  `,
  legendItem: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    color: ${theme.colors.text.primary};
    font-size: ${theme.typography.bodySmall.fontSize};
    cursor: pointer;
    padding: 0;
  `,
  swatch: css`
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex: none;
  `,
  tooltip: css`
    position: absolute;
    pointer-events: none;
    background: ${theme.colors.background.secondary};
    border: 1px solid ${theme.colors.border.medium};
    box-shadow: ${theme.shadows.z2};
    border-radius: ${theme.shape.radius.default};
    padding: ${theme.spacing(0.5, 1)};
    font-size: ${theme.typography.bodySmall.fontSize};
    z-index: 2;
    max-width: 260px;
  `,
  tooltipTime: css`
    color: ${theme.colors.text.secondary};
    margin-bottom: 2px;
  `,
  tooltipRow: css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  tooltipName: css`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  hint: css`
    color: ${theme.colors.text.disabled};
    margin-top: 2px;
  `,
  footer: css`
    height: 18px;
    line-height: 18px;
    padding: 0 ${theme.spacing(1)};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  live: css`
    color: ${theme.colors.error.text};
    font-weight: ${theme.typography.fontWeightBold};
    margin-right: ${theme.spacing(1)};
    animation: insightPulse 1.6s ease-in-out infinite;
    @keyframes insightPulse {
      50% {
        opacity: 0.35;
      }
    }
  `,
  aiBox: css`
    padding: 2px ${theme.spacing(1)} 4px;
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
    overflow: hidden;
  `,
  aiLine: css`
    height: 16px;
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  errorText: css`
    color: ${theme.colors.error.text};
  `,
  empty: css`
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: ${theme.colors.text.secondary};
    padding: ${theme.spacing(1)};
  `,
});
