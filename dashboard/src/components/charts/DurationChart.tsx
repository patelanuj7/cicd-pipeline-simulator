import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RunSummary } from '../../../server/apiTypes';
import type { ChartTheme } from '../../hooks/useChartTheme';
import { durationRows, type DurationRow } from '../../lib/chartData';
import { firstLine, formatDuration } from '../../lib/format';
import { describeStatus } from '../StatusBadge';
import { ChartCard, EmptyChart } from './ChartCard';
import { ChartTooltip } from './ChartTooltip';

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: DurationRow;
  index?: number;
}

export function DurationChart({ runs, theme }: { runs: RunSummary[]; theme: ChartTheme }) {
  const rows = durationRows(runs);
  const isFailed = (r?: DurationRow) => r?.conclusion === 'failure' || r?.conclusion === 'timed_out';

  // Failed runs get a red dot: a long failed run (e.g. a deploy health-check timeout)
  // explains an outlier. The legend names it, so it isn't color-only.
  const renderDot = ({ cx, cy, payload, index }: DotProps) =>
    cx == null || cy == null ? (
      <g key={index} />
    ) : (
      <circle
        key={index}
        cx={cx}
        cy={cy}
        r={4}
        fill={isFailed(payload) ? theme.fail : theme.pass}
        stroke={theme.surface}
        strokeWidth={2}
      />
    );

  return (
    <ChartCard
      className="chart-card--wide"
      title="Duration per run"
      subtitle={`Last ${rows.length} completed runs, oldest to newest`}
      legend={[
        { label: 'Duration', color: theme.pass, shape: 'line' },
        { label: 'Failed run', color: theme.fail, shape: 'dot' },
      ]}
      table={
        <table className="data-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Commit</th>
              <th>Result</th>
              <th className="num">Duration</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.runNumber}>
                <td>{r.label}</td>
                <td className="data-table__text">{firstLine(r.title)}</td>
                <td>{describeStatus('completed', r.conclusion).label}</td>
                <td className="num">{formatDuration(r.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {rows.length === 0 ? (
        <EmptyChart message="No completed runs yet." />
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={rows} margin={{ top: 12, right: 16, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: theme.axis }} tick={{ fill: theme.muted, fontSize: 12 }} minTickGap={16} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: theme.muted, fontSize: 12 }}
              tickFormatter={(m: number) => `${Math.round(m * 10) / 10}m`}
              domain={[0, 'auto']}
            />
            <Tooltip
              cursor={{ stroke: theme.axis, strokeWidth: 1 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as DurationRow | undefined;
                if (!active || !row) return null;
                return (
                  <ChartTooltip
                    heading={`Run ${row.label}`}
                    rows={[
                      {
                        label: describeStatus('completed', row.conclusion).label.toLowerCase(),
                        value: formatDuration(row.durationMs),
                        color: isFailed(row) ? theme.fail : theme.pass,
                      },
                    ]}
                    note={firstLine(row.title)}
                  />
                );
              }}
            />
            <Line
              // Straight segments: runs are discrete, a smoothed curve would invent in-between values.
              type="linear"
              dataKey="minutes"
              name="Duration"
              stroke={theme.pass}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={renderDot}
              activeDot={{ r: 5, stroke: theme.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
