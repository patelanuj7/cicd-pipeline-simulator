import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyStat } from '../../../server/apiTypes';
import type { ChartTheme } from '../../hooks/useChartTheme';
import { dailyRows, type DailyRow } from '../../lib/chartData';
import { ChartCard, EmptyChart } from './ChartCard';
import { ChartTooltip } from './ChartTooltip';

const GAP = 2; // surface gap between stacked segments
const RADIUS = 4; // rounded data-end; square at the baseline

/** A rect with only its top corners rounded. */
function topRoundedPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

interface SegmentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: DailyRow;
}

// Passed sits at the bottom; it only gets the rounded end when no failed segment sits on it.
function PassedSegment({ x = 0, y = 0, width = 0, height = 0, fill, payload }: SegmentProps) {
  if (height <= 0) return null;
  const r = payload && payload.failed > 0 ? 0 : RADIUS;
  return <path d={topRoundedPath(x, y, width, height, r)} fill={fill} />;
}

// Failed is always the top segment; trim its bottom to leave the surface gap.
function FailedSegment({ x = 0, y = 0, width = 0, height = 0, fill, payload }: SegmentProps) {
  if (height <= 0) return null;
  const gap = payload && payload.passed > 0 ? GAP : 0;
  return <path d={topRoundedPath(x, y, width, Math.max(0, height - gap), RADIUS)} fill={fill} />;
}

export function DailyChart({ daily, theme, timeZone }: { daily: DailyStat[]; theme: ChartTheme; timeZone: string }) {
  const rows = dailyRows(daily);

  return (
    <ChartCard
      title="Runs per day"
      subtitle={`Passed vs. failed, grouped by day (${timeZone})`}
      legend={[
        { label: 'Passed', color: theme.pass, shape: 'square' },
        { label: 'Failed', color: theme.fail, shape: 'square' },
      ]}
      table={
        <table className="data-table">
          <thead>
            <tr>
              <th>Day</th>
              <th className="num">Passed</th>
              <th className="num">Failed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date}>
                <td>{r.label}</td>
                <td className="num">{r.passed}</td>
                <td className="num">{r.failed}</td>
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
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: theme.axis }} tick={{ fill: theme.muted, fontSize: 12 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: theme.muted, fontSize: 12 }} />
            <Tooltip
              cursor={{ fill: theme.grid, opacity: 0.6 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as DailyRow | undefined;
                if (!active || !row) return null;
                const decided = row.passed + row.failed;
                return (
                  <ChartTooltip
                    heading={row.label}
                    rows={[
                      { label: 'passed', value: String(row.passed), color: theme.pass },
                      { label: 'failed', value: String(row.failed), color: theme.fail },
                    ]}
                    note={decided > 0 ? `${Math.round((row.passed / decided) * 100)}% pass rate` : undefined}
                  />
                );
              }}
            />
            <Bar dataKey="passed" name="Passed" stackId="runs" fill={theme.pass} maxBarSize={24} shape={PassedSegment} isAnimationActive={false} />
            <Bar dataKey="failed" name="Failed" stackId="runs" fill={theme.fail} maxBarSize={24} shape={FailedSegment} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
