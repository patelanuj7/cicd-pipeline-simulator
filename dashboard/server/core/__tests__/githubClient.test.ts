import { describe, expect, it, vi } from 'vitest';
import { createGitHubClient } from '../githubClient.js';
import { GitHubApiError, RateLimitError } from '../errors.js';
import { fakeFetch, json, run } from './fixtures.js';

const noSleep = vi.fn(async () => {});

function client(fetchImpl: typeof fetch, extra = {}) {
  return createGitHubClient({
    token: 'tok',
    owner: 'patelanuj7',
    repo: 'cicd-pipeline-simulator',
    fetchImpl,
    sleepImpl: noSleep,
    ...extra,
  });
}

describe('createGitHubClient', () => {
  it('requires a token, owner and repo', () => {
    expect(() => createGitHubClient({ token: '', owner: 'o', repo: 'r' })).toThrow(/token/);
    expect(() => createGitHubClient({ token: 't', owner: '', repo: 'r' })).toThrow(/owner/);
  });

  it('sends auth, API version and accept headers', async () => {
    const f = fakeFetch(json({ total_count: 0, workflow_runs: [] }));
    await client(f.impl).listWorkflowRuns();
    expect(f.calls[0]!.headers).toMatchObject({
      Authorization: 'Bearer tok',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    expect(f.calls[0]!.url).toBe(
      'https://api.github.com/repos/patelanuj7/cicd-pipeline-simulator/actions/runs?per_page=100&page=1',
    );
  });
});

describe('listWorkflowRuns', () => {
  it('paginates until a short page', async () => {
    const page1 = [run({ id: 1 }), run({ id: 2 })];
    const page2 = [run({ id: 3 })];
    const f = fakeFetch(
      json({ total_count: 3, workflow_runs: page1 }),
      json({ total_count: 3, workflow_runs: page2 }),
    );
    const runs = await client(f.impl).listWorkflowRuns({ perPage: 2 });
    expect(runs.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]!.url).toContain('page=2');
  });

  it('stops at total_count even when the page is full', async () => {
    const f = fakeFetch(json({ total_count: 2, workflow_runs: [run({ id: 1 }), run({ id: 2 })] }));
    await client(f.impl).listWorkflowRuns({ perPage: 2 });
    expect(f.calls).toHaveLength(1);
  });

  it('respects maxPages', async () => {
    const full = () => json({ total_count: 999, workflow_runs: [run(), run()] });
    const f = fakeFetch(full, full, full);
    const runs = await client(f.impl).listWorkflowRuns({ perPage: 2, maxPages: 2 });
    expect(f.calls).toHaveLength(2);
    expect(runs).toHaveLength(4);
  });

  it('removes duplicates that shift between pages', async () => {
    const f = fakeFetch(
      json({ total_count: 4, workflow_runs: [run({ id: 1 }), run({ id: 2 })] }),
      json({ total_count: 4, workflow_runs: [run({ id: 2 }), run({ id: 3 })] }),
      json({ total_count: 4, workflow_runs: [] }),
    );
    const runs = await client(f.impl).listWorkflowRuns({ perPage: 2 });
    expect(runs.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('uses the workflow endpoint and branch filter', async () => {
    const f = fakeFetch(json({ total_count: 0, workflow_runs: [] }));
    await client(f.impl).listWorkflowRuns({ workflowFile: 'pipeline.yml', branch: 'main' });
    expect(f.calls[0]!.url).toContain('/actions/workflows/pipeline.yml/runs?');
    expect(f.calls[0]!.url).toContain('branch=main');
  });

  it('clamps perPage to 1..100', async () => {
    const f = fakeFetch(json({ total_count: 0, workflow_runs: [] }));
    await client(f.impl).listWorkflowRuns({ perPage: 500 });
    expect(f.calls[0]!.url).toContain('per_page=100');
  });
});

describe('ETag caching', () => {
  it('sends If-None-Match and reuses the cached body on 304', async () => {
    const body = { total_count: 1, workflow_runs: [run({ id: 7 })] };
    const f = fakeFetch(
      json(body, { headers: { etag: 'W/"abc"' } }),
      new Response(null, { status: 304 }),
    );
    const c = client(f.impl);
    const first = await c.listWorkflowRuns();
    const second = await c.listWorkflowRuns();
    expect(f.calls[0]!.headers['If-None-Match']).toBeUndefined();
    expect(f.calls[1]!.headers['If-None-Match']).toBe('W/"abc"');
    expect(second).toEqual(first);
  });

  it('evicts the oldest entry when the cache is full', async () => {
    const tagged = (tag: string) =>
      json({ total_count: 0, jobs: [] }, { headers: { etag: tag } });
    const f = fakeFetch(tagged('a'), tagged('b'), tagged('c'), tagged('d'));
    const c = client(f.impl, { cacheSize: 2 });
    await c.listJobs(1); // cached: 1
    await c.listJobs(2); // cached: 1, 2
    await c.listJobs(3); // cached: 2, 3  (1 evicted)
    await c.listJobs(1); // must not send an ETag for run 1
    expect(f.calls[3]!.headers['If-None-Match']).toBeUndefined();
  });
});

describe('errors and retries', () => {
  it('retries 5xx with exponential backoff, then succeeds', async () => {
    noSleep.mockClear();
    const f = fakeFetch(
      json({ message: 'boom' }, { status: 502 }),
      json({ message: 'boom' }, { status: 503 }),
      json({ total_count: 0, workflow_runs: [] }),
    );
    await expect(client(f.impl, { baseDelayMs: 100 }).listWorkflowRuns()).resolves.toEqual([]);
    expect(noSleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([100, 200]);
  });

  it('retries network errors', async () => {
    const f = fakeFetch(new TypeError('fetch failed'), json({ total_count: 0, workflow_runs: [] }));
    await expect(client(f.impl).listWorkflowRuns()).resolves.toEqual([]);
  });

  it('gives up after maxRetries with a GitHubApiError', async () => {
    const f = fakeFetch(
      json({}, { status: 500 }),
      json({}, { status: 500 }),
      json({ message: 'still down' }, { status: 500 }),
    );
    const err = await client(f.impl, { maxRetries: 2 }).listWorkflowRuns().catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.status).toBe(500);
    expect(err.message).toContain('still down');
  });

  it('does not retry 4xx errors', async () => {
    const f = fakeFetch(json({ message: 'Not Found' }, { status: 404 }));
    const err = await client(f.impl).listJobs(5).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect(err.status).toBe(404);
    expect(f.calls).toHaveLength(1);
  });

  it('throws RateLimitError with the reset time on primary rate limit', async () => {
    const f = fakeFetch(
      json(
        { message: 'API rate limit exceeded' },
        { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } },
      ),
    );
    const err = await client(f.impl).listWorkflowRuns().catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.resetAt.getTime()).toBe(1_800_000_000_000);
    expect(f.calls).toHaveLength(1);
  });

  it('waits Retry-After on a secondary rate limit, then retries', async () => {
    noSleep.mockClear();
    const f = fakeFetch(
      json({ message: 'secondary' }, { status: 429, headers: { 'retry-after': '3' } }),
      json({ total_count: 0, workflow_runs: [] }),
    );
    await client(f.impl).listWorkflowRuns();
    expect(noSleep).toHaveBeenCalledWith(3000);
  });

  it('gives up on a Retry-After that is too long', async () => {
    const f = fakeFetch(
      json({ message: 'secondary' }, { status: 429, headers: { 'retry-after': '3600' } }),
    );
    const err = await client(f.impl).listWorkflowRuns().catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
  });

  it('treats a 403 without rate-limit headers as a permission error', async () => {
    const f = fakeFetch(json({ message: 'Resource not accessible' }, { status: 403 }));
    const err = await client(f.impl).listWorkflowRuns().catch((e) => e);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect(err.status).toBe(403);
  });

  it('handles non-JSON error bodies', async () => {
    const f = fakeFetch(new Response('<html>oops</html>', { status: 404, statusText: 'Not Found' }));
    const err = await client(f.impl).listJobs(1).catch((e) => e);
    expect(err.message).toBe('GitHub API 404: Not Found');
  });
});

describe('listJobs and getJobLogs', () => {
  it('lists the latest attempt of each job', async () => {
    const f = fakeFetch(json({ total_count: 1, jobs: [{ id: 1, name: 'lint' }] }));
    const jobs = await client(f.impl).listJobs(42);
    expect(jobs).toHaveLength(1);
    expect(f.calls[0]!.url).toContain('/actions/runs/42/jobs?');
    expect(f.calls[0]!.url).toContain('filter=latest');
  });

  it('returns log text', async () => {
    const f = fakeFetch(new Response('2026-10-15T12:00:00.0000000Z hello\n', { status: 200 }));
    const text = await client(f.impl).getJobLogs(99);
    expect(text).toContain('hello');
    expect(f.calls[0]!.url).toMatch(/\/actions\/jobs\/99\/logs$/);
  });

  it('rejects invalid ids before calling GitHub', async () => {
    const f = fakeFetch();
    await expect(client(f.impl).getJobLogs(-1)).rejects.toThrow(TypeError);
    await expect(client(f.impl).listJobs(1.5)).rejects.toThrow(TypeError);
    expect(f.calls).toHaveLength(0);
  });
});
