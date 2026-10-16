import express, { type ErrorRequestHandler, type Request } from 'express';
import {
  computeStats,
  GitHubApiError,
  parseLog,
  RateLimitError,
  runDurationMs,
  type GitHubClient,
  type Job,
  type WorkflowRun,
} from './core/index.js';
import type { JobSummary, RunSummary } from './apiTypes.js';

export interface AppOptions {
  /** Only runs of this workflow file are shown. Default "pipeline.yml". */
  workflowFile?: string;
  /** "owner/repo", shown in the UI header. */
  repo?: string;
}

// Stage-failure stats need each failed run's jobs (one API call per run), so cap
// how many failed runs we look at. ETag caching makes repeat polls nearly free.
const MAX_FAILED_RUNS_FOR_STAGES = 30;
const MAX_RUNS_LIMIT = 300;

/** 400 errors thrown inside handlers; the error handler turns them into JSON. */
class BadRequestError extends Error {}

function positiveInt(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new BadRequestError(`${name} must be a positive integer`);
  return n;
}

function optionalString(req: Request, name: string): string | undefined {
  const v = req.query[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v === '') throw new BadRequestError(`${name} must be a non-empty string`);
  return v;
}

function validTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    throw new BadRequestError(`unknown timeZone: ${tz}`);
  }
}

// GitHub returns large objects; the UI only needs these fields.
function toRunSummary(run: WorkflowRun): RunSummary {
  return {
    id: run.id,
    runNumber: run.run_number,
    runAttempt: run.run_attempt ?? 1,
    title: run.display_title ?? run.name ?? '',
    branch: run.head_branch,
    sha: run.head_sha,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    durationMs: runDurationMs(run),
    url: run.html_url,
    // html_url is https://github.com/<owner>/<repo>/actions/runs/<id>
    commitUrl: run.html_url.replace(/\/actions\/runs\/\d+.*$/, `/commit/${run.head_sha}`),
  };
}

function toJobSummary(job: Job): JobSummary {
  const started = job.started_at ? Date.parse(job.started_at) : NaN;
  const completed = job.completed_at ? Date.parse(job.completed_at) : NaN;
  return {
    id: job.id,
    runId: job.run_id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    durationMs: Number.isNaN(started) || Number.isNaN(completed) ? null : completed - started,
    url: job.html_url,
    steps: (job.steps ?? []).map((s) => ({
      number: s.number,
      name: s.name,
      status: s.status,
      conclusion: s.conclusion,
    })),
  };
}

export function createApiRouter(client: GitHubClient, options: AppOptions = {}) {
  const workflowFile = options.workflowFile ?? 'pipeline.yml';
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/config', (_req, res) => {
    res.json({ repo: options.repo ?? '', workflowFile });
  });

  router.get('/runs', async (req, res) => {
    const branch = optionalString(req, 'branch');
    const limit = req.query.limit === undefined ? 50 : Math.min(positiveInt(req.query.limit, 'limit'), MAX_RUNS_LIMIT);
    const runs = await client.listWorkflowRuns({
      workflowFile,
      branch,
      perPage: Math.min(limit, 100),
      maxPages: Math.ceil(limit / 100),
    });
    res.json({ runs: runs.slice(0, limit).map(toRunSummary) });
  });

  router.get('/stats', async (req, res) => {
    const branch = optionalString(req, 'branch');
    const tz = optionalString(req, 'timeZone');
    const timeZone = tz === undefined ? undefined : validTimeZone(tz);

    const runs = await client.listWorkflowRuns({ workflowFile, branch });
    const failedRuns = runs
      .filter((r) => r.status === 'completed' && r.conclusion === 'failure')
      .slice(0, MAX_FAILED_RUNS_FOR_STAGES);
    const jobLists = await Promise.all(failedRuns.map((r) => client.listJobs(r.id)));
    const jobsByRun = new Map(failedRuns.map((r, i) => [r.id, jobLists[i]!]));

    res.json(computeStats(runs, jobsByRun, { timeZone }));
  });

  router.get('/runs/:id/jobs', async (req, res) => {
    const jobs = await client.listJobs(positiveInt(req.params.id, 'run id'));
    res.json({ jobs: jobs.map(toJobSummary) });
  });

  router.get('/jobs/:id/logs', async (req, res) => {
    const raw = await client.getJobLogs(positiveInt(req.params.id, 'job id'));
    res.json(parseLog(raw));
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  return router;
}

// Express 5 forwards rejected promises from async handlers here automatically.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof BadRequestError) {
    res.status(400).json({ error: err.message });
  } else if (err instanceof RateLimitError) {
    const retryAfter = Math.max(0, Math.ceil((err.resetAt.getTime() - Date.now()) / 1000));
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'GitHub API rate limit exceeded', resetAt: err.resetAt.toISOString() });
  } else if (err instanceof GitHubApiError) {
    res.status(502).json({ error: 'GitHub API error', upstreamStatus: err.status, message: err.message });
  } else {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export function createApp(client: GitHubClient, options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', createApiRouter(client, options));
  app.use(errorHandler);
  return app;
}
