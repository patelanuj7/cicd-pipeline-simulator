import { useCallback, useEffect } from 'react';
import type { JobSummary, RunSummary } from '../../server/apiTypes';
import { describeError, fetchJson } from '../api';
import { replaceHash } from '../hooks/useHashRoute';
import { usePolling } from '../hooks/usePolling';
import { firstLine, formatDuration, formatRelative, shortSha } from '../lib/format';
import { defaultJob, runHref } from '../lib/route';
import { LogViewer } from './LogViewer';
import { describeStatus, StatusBadge } from './StatusBadge';

const POLL_MS = 20_000;

interface Props {
  runId: number;
  jobId: number | null;
  /** From the runs list, when this run is in it (used for the header). */
  run: RunSummary | undefined;
  now: number;
}

export function RunDetail({ runId, jobId, run, now }: Props) {
  const fetchJobs = useCallback(
    (signal: AbortSignal) => fetchJson<{ jobs: JobSummary[] }>(`/api/runs/${runId}/jobs`, signal).then((r) => r.jobs),
    [runId],
  );
  const jobs = usePolling(fetchJobs, POLL_MS);

  // No job in the URL: open the failing one (or the first) without adding a history entry.
  useEffect(() => {
    if (jobId == null && jobs.data) {
      const pick = defaultJob(jobs.data);
      if (pick) replaceHash(runHref(runId, pick.id));
    }
  }, [jobId, jobs.data, runId]);

  const selected = jobs.data?.find((j) => j.id === jobId) ?? null;

  return (
    <div className="run-detail">
      <a className="back-link" href="#/">
        ← All runs
      </a>

      <header className="run-header card">
        <div className="run-header__main">
          {run && <StatusBadge status={run.status} conclusion={run.conclusion} />}
          <h1 className="run-header__title">{run ? firstLine(run.title) : `Run ${runId}`}</h1>
        </div>
        {run && (
          <dl className="run-header__meta">
            <div>
              <dt>Run</dt>
              <dd>
                #{run.runNumber}
                {run.runAttempt > 1 && ` (attempt ${run.runAttempt})`}
              </dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd>
                <a className="sha" href={run.commitUrl} target="_blank" rel="noreferrer">
                  {shortSha(run.sha)}
                </a>
              </dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{run.branch && <span className="branch">{run.branch}</span>}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{run.status === 'completed' ? formatDuration(run.durationMs) : 'running…'}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{formatRelative(run.createdAt, now)}</dd>
            </div>
            <div>
              <dt>GitHub</dt>
              <dd>
                <a href={run.url} target="_blank" rel="noreferrer">
                  View run ↗
                </a>
              </dd>
            </div>
          </dl>
        )}
      </header>

      {jobs.error != null && (
        <div className="banner" role="alert">
          {describeError(jobs.error)}
        </div>
      )}

      <div className="run-body">
        <nav className="card jobs" aria-label="Jobs">
          <h2 className="card__title">Jobs</h2>
          {jobs.data === null ? (
            <div className="log-status">Loading jobs…</div>
          ) : jobs.data.length === 0 ? (
            <div className="log-status">No jobs in this run.</div>
          ) : (
            <ul className="jobs__list">
              {jobs.data.map((job) => {
                const { tone, icon, label } = describeStatus(job.status, job.conclusion);
                return (
                  <li key={job.id}>
                    <a
                      href={runHref(runId, job.id)}
                      className={`job ${job.id === jobId ? 'job--selected' : ''}`}
                      aria-current={job.id === jobId ? 'page' : undefined}
                    >
                      <span className={`job__icon tone--${tone}`} aria-label={label} title={label}>
                        {icon}
                      </span>
                      <span className="job__name">{job.name}</span>
                      <span className="job__duration">
                        {job.status === 'completed' ? formatDuration(job.durationMs) : label.toLowerCase()}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <section className="card logs" aria-label="Job log">
          <h2 className="card__title">
            {selected ? (
              <>
                {selected.name}
                {selected.url && (
                  <a className="logs__gh" href={selected.url} target="_blank" rel="noreferrer">
                    Open on GitHub ↗
                  </a>
                )}
              </>
            ) : (
              'Log'
            )}
          </h2>
          {selected ? (
            // key: a fresh viewer (and fresh scroll-to-error) per job.
            <LogViewer key={selected.id} jobId={selected.id} jobRunning={selected.status !== 'completed'} />
          ) : (
            <div className="log-status">{jobs.data ? 'Select a job to see its log.' : 'Loading…'}</div>
          )}
        </section>
      </div>
    </div>
  );
}
