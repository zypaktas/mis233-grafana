import React, { useMemo, useState } from 'react';
import { dateTimeFormat, GrafanaTheme2, PanelProps } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { HeatmapOptions } from '../types';
import { buildGrid, colorFor, textColorOn } from '../heatmap';

interface Props extends PanelProps<HeatmapOptions> {}

export const CREDIT = 'Campus Heatmap · Developed by Zeynep Sudem · MIS 233';

const LABEL_WIDTH = 150;
const AXIS_HEIGHT = 18;
const FOOTER_HEIGHT = 18;
const LEGEND_HEIGHT = 16;

export const HeatmapPanel: React.FC<Props> = ({
  options,
  data,
  width,
  height,
  timeRange,
  timeZone,
  onChangeTimeRange,
}) => {
  const styles = useStyles2(getStyles);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  const from = timeRange.from.valueOf();
  const to = timeRange.to.valueOf();
  const narrow = width < 420;
  const labelWidth = narrow ? 90 : LABEL_WIDTH;
  const gridWidth = Math.max(20, width - labelWidth - 8);
  const buckets = options.buckets > 0 ? options.buckets : Math.max(4, Math.floor(gridWidth / 18));

  const grid = useMemo(() => buildGrid(data.series, from, to, buckets), [data.series, from, to, buckets]);
  const errorText = (data.errors ?? []).map((e) => e.message).join(' · ');

  const gridHeight = Math.max(20, height - AXIS_HEIGHT - LEGEND_HEIGHT - FOOTER_HEIGHT);
  const rowHeight = grid.rows.length ? gridHeight / grid.rows.length : gridHeight;
  const cellWidth = gridWidth / buckets;
  const fmt = (t: number, f: string) => dateTimeFormat(t, { format: f, timeZone });
  const span = to - from;
  const tickFormat = span > 2 * 86400000 ? 'MM/DD HH:mm' : 'HH:mm';
  const tickEvery = Math.max(1, Math.ceil(buckets / Math.max(2, Math.floor(gridWidth / 90))));

  if (grid.rows.length === 0) {
    return (
      <div className={styles.wrapper} style={{ width, height }}>
        <div className={styles.empty}>{errorText ? `⚠ ${errorText}` : 'No time series data'}</div>
        <div className={styles.footer}>{CREDIT}</div>
      </div>
    );
  }

  const onRowClick = (id?: string) => {
    if (options.variableName && id) {
      locationService.partial({ [`var-${options.variableName}`]: id }, true);
    }
  };

  const onCellClick = (col: number) => {
    // Zoom the dashboard to the clicked bucket.
    onChangeTimeRange({ from: grid.bucketStarts[col], to: grid.bucketStarts[col] + grid.bucketMs });
  };

  const hovered = hover ? grid.rows[hover.row] : undefined;
  const hoveredValue = hover && hovered ? hovered.cells[hover.col] : null;

  return (
    <div className={styles.wrapper} style={{ width, height }}>
      <svg
        width={width}
        height={gridHeight + AXIS_HEIGHT}
        data-testid="heatmap-grid"
        onMouseLeave={() => setHover(null)}
      >
        {grid.rows.map((row, r) => (
          <g key={row.name} transform={`translate(0, ${r * rowHeight})`}>
            <text
              x={labelWidth - 6}
              y={rowHeight / 2}
              dy="0.32em"
              textAnchor="end"
              className={options.variableName && row.id ? styles.rowLabelLink : styles.rowLabel}
              onClick={() => onRowClick(row.id)}
            >
              <title>{options.variableName && row.id ? `Show only ${row.name}` : row.name}</title>
              {row.name.length > (narrow ? 11 : 20) ? row.name.slice(0, narrow ? 10 : 19) + '…' : row.name}
            </text>
            {row.cells.map((v, c) => {
              const fill = v === null ? 'transparent' : colorFor(v, grid.min, grid.max, options.colorScheme);
              const isHover = hover?.row === r && hover?.col === c;
              return (
                <g
                  key={c}
                  onMouseEnter={() => setHover({ row: r, col: c })}
                  onClick={() => onCellClick(c)}
                  style={{ cursor: 'zoom-in' }}
                >
                  <rect
                    data-testid="heatmap-cell"
                    x={labelWidth + c * cellWidth + 0.5}
                    y={0.5}
                    width={Math.max(0, cellWidth - 1)}
                    height={Math.max(0, rowHeight - 1)}
                    rx={2}
                    fill={fill}
                    stroke={isHover ? '#fff' : 'none'}
                    strokeWidth={isHover ? 1.5 : 0}
                  />
                  {options.showValues && v !== null && cellWidth > 34 && rowHeight > 16 && (
                    <text
                      x={labelWidth + (c + 0.5) * cellWidth}
                      y={rowHeight / 2}
                      dy="0.32em"
                      textAnchor="middle"
                      className={styles.cellText}
                      fill={textColorOn(fill)}
                      pointerEvents="none"
                    >
                      {v >= 100 ? v.toFixed(0) : v.toFixed(1)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
        {grid.bucketStarts.map((t, c) =>
          c % tickEvery === 0 ? (
            <text key={t} x={labelWidth + c * cellWidth} y={gridHeight + 13} className={styles.axis}>
              {fmt(t, tickFormat)}
            </text>
          ) : null
        )}
      </svg>

      <div className={styles.legend}>
        <span>{grid.min.toFixed(1)}</span>
        <span
          className={styles.legendBar}
          style={{
            background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1]
              .map((x) => colorFor(grid.min + x * (grid.max - grid.min), grid.min, grid.max, options.colorScheme))
              .join(', ')})`,
          }}
        />
        <span>{grid.max.toFixed(1)}</span>
        {hover && hovered && (
          <span className={styles.hoverInfo} data-testid="heatmap-hover">
            {hovered.name} · {fmt(grid.bucketStarts[hover.col], 'MMM D HH:mm')}–
            {fmt(grid.bucketStarts[hover.col] + grid.bucketMs, 'HH:mm')}:{' '}
            <b>{hoveredValue === null ? 'no data' : hoveredValue.toFixed(2)}</b>
          </span>
        )}
      </div>
      <div className={styles.footer} data-testid="developer-credit">
        {CREDIT}
      </div>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css`
    display: flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
  `,
  rowLabel: css`
    fill: ${theme.colors.text.primary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  rowLabelLink: css`
    fill: ${theme.colors.text.link};
    font-size: ${theme.typography.bodySmall.fontSize};
    cursor: pointer;
    &:hover {
      text-decoration: underline;
    }
  `,
  cellText: css`
    font-size: 10px;
  `,
  axis: css`
    fill: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  legend: css`
    display: flex;
    align-items: center;
    gap: 6px;
    height: ${LEGEND_HEIGHT}px;
    padding: 0 ${theme.spacing(1)};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
    white-space: nowrap;
    overflow: hidden;
  `,
  legendBar: css`
    width: 120px;
    height: 8px;
    border-radius: 4px;
    flex: none;
  `,
  hoverInfo: css`
    margin-left: ${theme.spacing(2)};
    color: ${theme.colors.text.primary};
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  footer: css`
    height: ${FOOTER_HEIGHT}px;
    line-height: ${FOOTER_HEIGHT}px;
    padding: 0 ${theme.spacing(1)};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  empty: css`
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${theme.colors.text.secondary};
  `,
});
