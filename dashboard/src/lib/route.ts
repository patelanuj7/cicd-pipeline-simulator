import type { JobSummary } from '../../server/apiTypes';

/** Hash routes, so deep links work without server-side routing: #/runs/123/jobs/456 */
export type Route = { page: 'dashboard' } | { page: 'run'; runId: number; jobId: number | null };

export function parseHash(hash: string): Route {
  const m = /^#\/runs\/(\d+)(?:\/jobs\/(\d+))?\/?$/.exec(hash);
  if (!m) return { page: 'dashboard' };
  return { page: 'run', runId: Number(m[1]), jobId: m[2] ? Number(m[2]) : null };
}

export function runHref(runId: number, jobId?: number | null): string {
  return jobId == null ? `#/runs/${runId}` : `#/runs/${runId}/jobs/${jobId}`;
}

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

/**
 * The job to open first: the earliest failed job (that's where the error is),
 * else whatever is running, else the first job.
 */
export function defaultJob(jobs: JobSummary[]): JobSummary | null {
  const byStart = [...jobs].sort(
    (a, b) => (a.startedAt ? Date.parse(a.startedAt) : Infinity) - (b.startedAt ? Date.parse(b.startedAt) : Infinity),
  );
  return (
    byStart.find((j) => j.conclusion !== null && FAILED.has(j.conclusion)) ??
    byStart.find((j) => j.status === 'in_progress') ??
    jobs[0] ??
    null
  );
}
