import { describe, expect, it } from 'vitest';
import type { JobSummary } from '../../server/apiTypes';
import { defaultJob, parseHash, runHref } from './route';

describe('parseHash / runHref', () => {
  it.each([
    ['', { page: 'dashboard' }],
    ['#/', { page: 'dashboard' }],
    ['#/runs/abc', { page: 'dashboard' }],
    ['#/runs/123', { page: 'run', runId: 123, jobId: null }],
    ['#/runs/123/', { page: 'run', runId: 123, jobId: null }],
    ['#/runs/123/jobs/456', { page: 'run', runId: 123, jobId: 456 }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it('round-trips', () => {
    expect(parseHash(runHref(7))).toEqual({ page: 'run', runId: 7, jobId: null });
    expect(parseHash(runHref(7, 9))).toEqual({ page: 'run', runId: 7, jobId: 9 });
  });
});

function job(id: number, name: string, overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id,
    runId: 1,
    name,
    status: 'completed',
    conclusion: 'success',
    startedAt: `2026-10-16T12:0${id}:00Z`,
    completedAt: null,
    durationMs: null,
    url: null,
    steps: [],
    ...overrides,
  };
}

describe('defaultJob', () => {
  it('picks the earliest failed job', () => {
    const jobs = [
      job(4, 'deploy', { conclusion: 'failure' }),
      job(1, 'lint'),
      job(2, 'test', { conclusion: 'failure' }),
    ];
    expect(defaultJob(jobs)?.name).toBe('test');
  });

  it('treats timed_out as failed', () => {
    expect(defaultJob([job(1, 'lint'), job(2, 'test', { conclusion: 'timed_out' })])?.name).toBe('test');
  });

  it('falls back to the running job, then the first job', () => {
    expect(defaultJob([job(1, 'lint'), job(2, 'test', { status: 'in_progress', conclusion: null })])?.name).toBe('test');
    expect(defaultJob([job(1, 'lint'), job(2, 'test')])?.name).toBe('lint');
  });

  it('returns null for no jobs', () => {
    expect(defaultJob([])).toBeNull();
  });
});
