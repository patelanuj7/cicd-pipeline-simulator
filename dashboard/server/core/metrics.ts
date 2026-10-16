import type { Conclusion, Job, WorkflowRun } from './types.js';

export interface DailyStat {
  /** YYYY-MM-DD in the requested time zone. */
  date: string;
  succeeded: number;
  failed: number;
  passRate: number | null;
}

export interface Stats {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  inProgress: number;
  /** succeeded / (succeeded + failed), 0..1. null when nothing has finished yet. */
  passRate: number | null;
  /** Wall-clock run duration over completed runs. null when there are none. */
  durationMs: { p50: number | null; p95: number | null; avg: number | null };
  /** For each failed run, the name of the first job that failed. Needs jobsByRun. */
  stageFailures: Record<string, number>;
  /**
   * Commits that failed and then passed with no code change: either a later run on the same
   * SHA succeeded after a failed one, or a run only succeeded on a re-run (attempt > 1).
   */
  flakyShas: string[];
  /** Oldest day first. */
  daily: DailyStat[];
}

export interface StatsOptions {
  /** IANA time zone for grouping runs into days, e.g. "America/New_York". Default UTC. */
  timeZone?: string;
}

const FAILED: ReadonlySet<Conclusion> = new Set(['failure', 'timed_out', 'startup_failure']);

export const isSuccess = (c: Conclusion) => c === 'success';
export const isFailure = (c: Conclusion) => FAILED.has(c);

export function computeStats(
  runs: WorkflowRun[],
  jobsByRun: Map<number, Job[]> = new Map(),
  options: StatsOptions = {},
): Stats {
  const completedRuns = runs.filter((r) => r.status === 'completed');
  const succeeded = completedRuns.filter((r) => isSuccess(r.conclusion)).length;
  const failed = completedRuns.filter((r) => isFailure(r.conclusion)).length;
  const cancelled = completedRuns.filter((r) => r.conclusion === 'cancelled').length;

  const durations = completedRuns
    .map(runDurationMs)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);

  return {
    total: runs.length,
    completed: completedRuns.length,
    succeeded,
    failed,
    cancelled,
    inProgress: runs.length - completedRuns.length,
    passRate: ratio(succeeded, failed),
    durationMs: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      avg: durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : null,
    },
    stageFailures: stageFailures(completedRuns, jobsByRun),
    flakyShas: flakyShas(completedRuns),
    daily: daily(completedRuns, options.timeZone ?? 'UTC'),
  };
}

/** Run duration in ms, or null if timestamps are missing or nonsensical. */
export function runDurationMs(run: WorkflowRun): number | null {
  // run_started_at is when the latest attempt started; created_at is the fallback.
  const start = Date.parse(run.run_started_at ?? run.created_at);
  const end = Date.parse(run.updated_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

/** Nearest-rank percentile on an ascending-sorted array. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? null;
}

function ratio(succeeded: number, failed: number): number | null {
  const decided = succeeded + failed;
  return decided === 0 ? null : succeeded / decided;
}

function stageFailures(runs: WorkflowRun[], jobsByRun: Map<number, Job[]>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const run of runs) {
    if (!isFailure(run.conclusion)) continue;
    const jobs = jobsByRun.get(run.id);
    if (!jobs?.length) continue;

    // Jobs after a failure are usually "skipped", so the earliest failed job is the culprit.
    const firstFailed = jobs
      .filter((j) => isFailure(j.conclusion))
      .sort((a, b) => timeOrInfinity(a.started_at) - timeOrInfinity(b.started_at))[0];
    if (firstFailed) counts[firstFailed.name] = (counts[firstFailed.name] ?? 0) + 1;
  }
  return counts;
}

function flakyShas(runs: WorkflowRun[]): string[] {
  const bySha = new Map<string, WorkflowRun[]>();
  for (const run of runs) {
    const list = bySha.get(run.head_sha) ?? [];
    list.push(run);
    bySha.set(run.head_sha, list);
  }

  const flaky: string[] = [];
  for (const [sha, list] of bySha) {
    const ordered = [...list].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const passedOnRerun = ordered.some((r) => isSuccess(r.conclusion) && (r.run_attempt ?? 1) > 1);
    const firstFailure = ordered.findIndex((r) => isFailure(r.conclusion));
    const passedLater =
      firstFailure !== -1 && ordered.slice(firstFailure + 1).some((r) => isSuccess(r.conclusion));
    if (passedOnRerun || passedLater) flaky.push(sha);
  }
  return flaky.sort();
}

function daily(runs: WorkflowRun[], timeZone: string): DailyStat[] {
  // en-CA formats dates as YYYY-MM-DD, which also sorts correctly as a string.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const byDay = new Map<string, { succeeded: number; failed: number }>();
  for (const run of runs) {
    const t = Date.parse(run.created_at);
    if (Number.isNaN(t)) continue;
    const date = fmt.format(t);
    const day = byDay.get(date) ?? { succeeded: 0, failed: 0 };
    if (isSuccess(run.conclusion)) day.succeeded++;
    else if (isFailure(run.conclusion)) day.failed++;
    byDay.set(date, day);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, ...d, passRate: ratio(d.succeeded, d.failed) }));
}

function timeOrInfinity(iso: string | null): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}
