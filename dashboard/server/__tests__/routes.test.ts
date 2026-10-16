import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { GitHubApiError, RateLimitError, type GitHubClient } from '../core/index.js';
import { job, run } from '../core/__tests__/fixtures.js';
import { createApp } from '../routes.js';

function fakeClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    listWorkflowRuns: vi.fn(async () => []),
    listJobs: vi.fn(async () => []),
    getJobLogs: vi.fn(async () => ''),
    ...overrides,
  };
}

describe('GET /api/health', () => {
  it('responds without calling GitHub', async () => {
    const client = fakeClient();
    const res = await request(createApp(client)).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(client.listWorkflowRuns).not.toHaveBeenCalled();
  });
});

describe('GET /api/runs', () => {
  it('returns trimmed run summaries for the pipeline workflow', async () => {
    const r = run({ id: 1, head_sha: 'abc123', display_title: 'feat: thing' });
    const client = fakeClient({ listWorkflowRuns: vi.fn(async () => [r]) });

    const res = await request(createApp(client)).get('/api/runs');

    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([
      {
        id: 1,
        runNumber: r.run_number,
        runAttempt: 1,
        title: 'feat: thing',
        branch: 'main',
        sha: 'abc123',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        durationMs: 120_000,
        url: r.html_url,
      },
    ]);
    expect(client.listWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ workflowFile: 'pipeline.yml', perPage: 50, maxPages: 1 }),
    );
  });

  it('passes branch and limit through, capping the limit', async () => {
    const client = fakeClient();
    await request(createApp(client)).get('/api/runs?branch=dev&limit=1000');
    expect(client.listWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ branch: 'dev', perPage: 100, maxPages: 3 }),
    );
  });

  it('rejects a bad limit with 400', async () => {
    const res = await request(createApp(fakeClient())).get('/api/runs?limit=abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/);
  });

  it('honours a custom workflow file', async () => {
    const client = fakeClient();
    await request(createApp(client, { workflowFile: 'other.yml' })).get('/api/runs');
    expect(client.listWorkflowRuns).toHaveBeenCalledWith(expect.objectContaining({ workflowFile: 'other.yml' }));
  });
});

describe('GET /api/stats', () => {
  it('computes stats, fetching jobs only for failed runs', async () => {
    const ok = run({ id: 10 });
    const bad = run({ id: 11, conclusion: 'failure' });
    const listJobs = vi.fn(async (runId: number) => [
      job(runId, 'lint', 'success', '2026-10-15T12:00:00Z'),
      job(runId, 'test', 'failure', '2026-10-15T12:01:00Z'),
    ]);
    const client = fakeClient({ listWorkflowRuns: vi.fn(async () => [ok, bad]), listJobs });

    const res = await request(createApp(client)).get('/api/stats');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, succeeded: 1, failed: 1, passRate: 0.5, stageFailures: { test: 1 } });
    expect(listJobs).toHaveBeenCalledTimes(1);
    expect(listJobs).toHaveBeenCalledWith(11);
  });

  it('rejects an unknown timeZone with 400', async () => {
    const res = await request(createApp(fakeClient())).get('/api/stats?timeZone=Mars/Olympus');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timeZone/);
  });

  it('accepts a valid timeZone', async () => {
    const res = await request(createApp(fakeClient())).get('/api/stats?timeZone=America/New_York');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/runs/:id/jobs', () => {
  it('returns job summaries with durations and steps', async () => {
    const j = {
      ...job(5, 'test', 'failure', '2026-10-15T12:00:00Z'),
      completed_at: '2026-10-15T12:00:30Z',
      steps: [{ number: 1, name: 'npm ci', status: 'completed', conclusion: 'success' as const }],
    };
    const client = fakeClient({ listJobs: vi.fn(async () => [j]) });

    const res = await request(createApp(client)).get('/api/runs/5/jobs');

    expect(res.status).toBe(200);
    expect(client.listJobs).toHaveBeenCalledWith(5);
    expect(res.body.jobs[0]).toMatchObject({
      id: j.id,
      name: 'test',
      conclusion: 'failure',
      durationMs: 30_000,
      steps: [{ number: 1, name: 'npm ci', status: 'completed', conclusion: 'success' }],
    });
  });

  it('rejects a non-numeric id with 400 without calling GitHub', async () => {
    const client = fakeClient();
    const res = await request(createApp(client)).get('/api/runs/abc/jobs');
    expect(res.status).toBe(400);
    expect(client.listJobs).not.toHaveBeenCalled();
  });
});

describe('GET /api/jobs/:id/logs', () => {
  it('returns the parsed log', async () => {
    const raw = [
      '2026-10-15T12:00:00.0000000Z ##[group]Run npm test',
      '2026-10-15T12:00:00.0000000Z npm test',
      '2026-10-15T12:00:01.0000000Z ##[endgroup]',
      '2026-10-15T12:00:02.0000000Z ##[error]Process completed with exit code 1.',
    ].join('\n');
    const client = fakeClient({ getJobLogs: vi.fn(async () => raw) });

    const res = await request(createApp(client)).get('/api/jobs/42/logs');

    expect(res.status).toBe(200);
    expect(client.getJobLogs).toHaveBeenCalledWith(42);
    expect(res.body.errorCount).toBe(1);
    expect(res.body.groups[0]).toMatchObject({ title: 'Run npm test', hasError: true });
  });
});

describe('error mapping', () => {
  it('maps RateLimitError to 429 with the reset time and Retry-After', async () => {
    const resetAt = new Date(Date.now() + 90_000);
    const client = fakeClient({
      listWorkflowRuns: vi.fn(async () => {
        throw new RateLimitError(resetAt);
      }),
    });

    const res = await request(createApp(client)).get('/api/runs');

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'GitHub API rate limit exceeded', resetAt: resetAt.toISOString() });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(80);
  });

  it('maps other GitHub API errors to 502', async () => {
    const client = fakeClient({
      listJobs: vi.fn(async () => {
        throw new GitHubApiError(404, 'Not Found');
      }),
    });

    const res = await request(createApp(client)).get('/api/runs/1/jobs');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'GitHub API error', upstreamStatus: 404, message: 'Not Found' });
  });

  it('maps unexpected errors to 500 without leaking details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = fakeClient({
      getJobLogs: vi.fn(async () => {
        throw new Error('secret internals');
      }),
    });

    const res = await request(createApp(client)).get('/api/jobs/1/logs');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(createApp(fakeClient())).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });
});
