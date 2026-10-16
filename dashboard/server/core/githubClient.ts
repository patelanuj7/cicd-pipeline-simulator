import { GitHubApiError, RateLimitError } from './errors.js';
import type { Job, WorkflowRun } from './types.js';

export interface GitHubClientOptions {
  token: string;
  owner: string;
  repo: string;
  /** Injected so tests can run without the network. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected so tests don't actually wait. Defaults to setTimeout. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Retries for network errors and 5xx responses. Default 3. */
  maxRetries?: number;
  /** First retry delay; doubles each attempt. Default 500ms. */
  baseDelayMs?: number;
  /** Wait for a secondary rate limit only if Retry-After is at most this. Default 60s. */
  maxRetryAfterMs?: number;
  /** Max responses kept in the ETag cache. Default 500. */
  cacheSize?: number;
  baseUrl?: string;
}

export interface ListRunsOptions {
  /** Runs per page, 1-100. Default 100. */
  perPage?: number;
  /** Stop after this many pages. Default 3 (= up to 300 runs). */
  maxPages?: number;
  branch?: string;
  /** e.g. "pipeline.yml". Limits results to one workflow. */
  workflowFile?: string;
}

export interface GitHubClient {
  listWorkflowRuns(opts?: ListRunsOptions): Promise<WorkflowRun[]>;
  listJobs(runId: number): Promise<Job[]>;
  getJobLogs(jobId: number): Promise<string>;
}

interface CacheEntry {
  etag: string;
  body: unknown;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const {
    token,
    owner,
    repo,
    fetchImpl = globalThis.fetch,
    sleepImpl = defaultSleep,
    maxRetries = 3,
    baseDelayMs = 500,
    maxRetryAfterMs = 60_000,
    cacheSize = 500,
    baseUrl = 'https://api.github.com',
  } = options;

  if (!token) throw new Error('createGitHubClient: token is required');
  if (!owner || !repo) throw new Error('createGitHubClient: owner and repo are required');

  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const etagCache = new Map<string, CacheEntry>();

  function remember(url: string, entry: CacheEntry) {
    // Map keeps insertion order, so deleting + re-setting moves an entry to the end
    // and the first key is always the least recently stored one.
    etagCache.delete(url);
    etagCache.set(url, entry);
    if (etagCache.size > cacheSize) {
      const oldest = etagCache.keys().next().value;
      if (oldest !== undefined) etagCache.delete(oldest);
    }
  }

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cicd-pipeline-simulator-dashboard',
      ...extra,
    };
  }

  /**
   * Sends a request with retries. Returns the Response for any 2xx or 304.
   * Throws RateLimitError / GitHubApiError otherwise.
   */
  async function send(url: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await fetchImpl(url, { headers: headers(extraHeaders) });
      } catch (err) {
        // Network failure (DNS, reset, etc.): retry with backoff.
        if (attempt < maxRetries) {
          await sleepImpl(baseDelayMs * 2 ** attempt);
          attempt++;
          continue;
        }
        throw new GitHubApiError(0, `Network error calling GitHub: ${(err as Error).message}`);
      }

      if (res.ok || res.status === 304) return res;

      // Rate limits come back as 403 or 429.
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        const reset = res.headers.get('x-ratelimit-reset');
        const retryAfter = res.headers.get('retry-after');

        if (remaining === '0') {
          // Primary limit: nothing to do until the window resets.
          const resetAt = reset ? new Date(Number(reset) * 1000) : new Date(Date.now() + 60_000);
          throw new RateLimitError(resetAt);
        }
        if (retryAfter !== null) {
          // Secondary limit: GitHub tells us how long to back off.
          const waitMs = Number(retryAfter) * 1000;
          if (Number.isFinite(waitMs) && waitMs <= maxRetryAfterMs && attempt < maxRetries) {
            await sleepImpl(waitMs);
            attempt++;
            continue;
          }
          throw new RateLimitError(new Date(Date.now() + (Number.isFinite(waitMs) ? waitMs : 60_000)));
        }
        // Otherwise it's a real permission error: fall through.
      }

      if (res.status >= 500 && attempt < maxRetries) {
        await sleepImpl(baseDelayMs * 2 ** attempt);
        attempt++;
        continue;
      }

      throw new GitHubApiError(res.status, await errorMessage(res));
    }
  }

  /** GET JSON with ETag caching. A 304 reuses the cached body and doesn't cost rate limit. */
  async function getJson<T>(path: string): Promise<T> {
    const url = `${baseUrl}${path}`;
    const cached = etagCache.get(url);
    const res = await send(url, cached ? { 'If-None-Match': cached.etag } : {});

    if (res.status === 304) {
      if (cached) return cached.body as T;
      // 304 without a cache entry shouldn't happen; treat it as an error rather than return junk.
      throw new GitHubApiError(304, 'Received 304 Not Modified without a cached response');
    }

    const body = (await res.json()) as T;
    const etag = res.headers.get('etag');
    if (etag) remember(url, { etag, body });
    return body;
  }

  async function listWorkflowRuns(opts: ListRunsOptions = {}): Promise<WorkflowRun[]> {
    const perPage = clamp(opts.perPage ?? 100, 1, 100);
    const maxPages = Math.max(1, opts.maxPages ?? 3);
    const base = opts.workflowFile
      ? `${repoPath}/actions/workflows/${encodeURIComponent(opts.workflowFile)}/runs`
      : `${repoPath}/actions/runs`;

    const runs: WorkflowRun[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({ per_page: String(perPage), page: String(page) });
      if (opts.branch) params.set('branch', opts.branch);

      const data = await getJson<{ total_count: number; workflow_runs: WorkflowRun[] }>(
        `${base}?${params}`,
      );
      runs.push(...data.workflow_runs);

      const isLastPage = data.workflow_runs.length < perPage || runs.length >= data.total_count;
      if (isLastPage) break;
    }
    return dedupeById(runs);
  }

  async function listJobs(runId: number): Promise<Job[]> {
    assertId(runId, 'runId');
    const jobs: Job[] = [];
    // A run rarely has more than 100 jobs, but paginate anyway to be correct.
    for (let page = 1; page <= 10; page++) {
      const params = new URLSearchParams({ per_page: '100', page: String(page), filter: 'latest' });
      const data = await getJson<{ total_count: number; jobs: Job[] }>(
        `${repoPath}/actions/runs/${runId}/jobs?${params}`,
      );
      jobs.push(...data.jobs);
      if (data.jobs.length < 100 || jobs.length >= data.total_count) break;
    }
    return jobs;
  }

  /**
   * GitHub answers with a 302 redirect to a short-lived storage URL.
   * fetch follows it automatically and drops the Authorization header on the
   * cross-origin hop, which is what that storage URL expects.
   */
  async function getJobLogs(jobId: number): Promise<string> {
    assertId(jobId, 'jobId');
    const res = await send(`${baseUrl}${repoPath}/actions/jobs/${jobId}/logs`);
    return res.text();
  }

  return { listWorkflowRuns, listJobs, getJobLogs };
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    if (body?.message) return `GitHub API ${res.status}: ${body.message}`;
  } catch {
    // Body wasn't JSON; use the status text instead.
  }
  return `GitHub API ${res.status}: ${res.statusText || 'request failed'}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function assertId(id: number, name: string) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError(`${name} must be a positive integer`);
}

/** New runs can shift pages while we paginate, so the same run may appear twice. */
function dedupeById(runs: WorkflowRun[]): WorkflowRun[] {
  const seen = new Set<number>();
  return runs.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}
