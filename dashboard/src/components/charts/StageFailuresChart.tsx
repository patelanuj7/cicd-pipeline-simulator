import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ChartTheme } from '../../hooks/useChartTheme';
import { stageRows, type StageRow } from '../../lib/chartData';
import { ChartCard } from './ChartCard';
import { ChartTooltip } from './ChartTooltip';

export function StageFailuresChart({
  stageFailures,
  failedRuns,
  theme,
}: {
  stageFailures: Record<string, number>;
  failedRuns: number;
  theme: ChartTheme;
}) {
  const rows = stageRows(stageFailures);

  return (
    <ChartCard
      title="Failures by stage"
      subtitle={
        failedRuns === 0 ? 'No failed runs yet' : `First failing stage of each failed run (${failedRuns} total)`
      }
      table={
        <table className="data-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th className="num">Failures</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stage}>
                <td>{r.stage}</td>
                <td className="num">{r.failures}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows} margin={{ top: 20, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke={theme.grid} />
          <XAxis dataKey="stage" tickLine={false} axisLine={{ stroke: theme.axis }} tick={{ fill: theme.muted, fontSize: 12 }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: theme.muted, fontSize: 12 }} domain={[0, (max: number) => Math.max(1, max)]} />
          <Tooltip
            cursor={{ fill: theme.grid, opacity: 0.6 }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as StageRow | undefined;
              if (!active || !row) return null;
              return (
                <ChartTooltip
                  heading={row.stage}
                  rows={[{ label: row.failures === 1 ? 'failure' : 'failures', value: String(row.failures), color: theme.fail }]}
                />
              );
            }}
          />
          <Bar dataKey="failures" name="Failures" fill={theme.fail} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {/* Value on the cap, in text ink (never the series color). Zero-height bars get no
                label; stages with no failures still appear on the axis and in the table. */}
            <LabelList dataKey="failures" position="top" fill={theme.text} fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
