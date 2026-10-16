import type { DailyStat, RunSummary } from '../../server/apiTypes';

/** Pipeline stages in execution order, so the stage chart reads left to right like the pipeline. */
export const PIPELINE_STAGES = ['lint', 'test', 'build', 'deploy'] as const;

export interface DailyRow {
  date: string;
  label: string;
  passed: number;
  failed: number;
}

/** "2026-10-16" -> "Oct 16" (formatted as a calendar date, not shifted by time zone). */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function dailyRows(daily: DailyStat[]): DailyRow[] {
  return daily.map((d) => ({ date: d.date, label: dayLabel(d.date), passed: d.succeeded, failed: d.failed }));
}

export interface DurationRow {
  label: string;
  runNumber: number;
  minutes: number;
  durationMs: number;
  title: string;
  conclusion: RunSummary['conclusion'];
}

/** Completed runs with a duration, oldest first (runs arrive newest first). */
export function durationRows(runs: RunSummary[]): DurationRow[] {
  return runs
    .filter((r) => r.status === 'completed' && r.durationMs != null)
    .map((r) => ({
      label: `#${r.runNumber}`,
      runNumber: r.runNumber,
      minutes: r.durationMs! / 60_000,
      durationMs: r.durationMs!,
      title: r.title,
      conclusion: r.conclusion,
    }))
    .sort((a, b) => a.runNumber - b.runNumber);
}

export interface StageRow {
  stage: string;
  failures: number;
}

/** Every known stage (zeros included, so "no failures" is visible), then any others. */
export function stageRows(stageFailures: Record<string, number>): StageRow[] {
  const known: string[] = [...PIPELINE_STAGES];
  const extra = Object.keys(stageFailures)
    .filter((s) => !known.includes(s))
    .sort();
  return [...known, ...extra].map((stage) => ({ stage, failures: stageFailures[stage] ?? 0 }));
}
