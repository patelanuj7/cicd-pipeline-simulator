import type { Conclusion, Job, WorkflowRun } from '../types.js';

let nextId = 1000;

export function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  const id = overrides.id ?? nextId++;
  return {
    id,
    name: 'pipeline',
    display_title: `commit ${id}`,
    head_branch: 'main',
    head_sha: `sha${id}`,
    status: 'completed',
    conclusion: 'success',
    run_number: id,
    run_attempt: 1,
    event: 'push',
    created_at: '2026-10-15T12:00:00Z',
    run_started_at: '2026-10-15T12:00:00Z',
    updated_at: '2026-10-15T12:02:00Z',
    html_url: `https://github.com/o/r/actions/runs/${id}`,
    ...overrides,
  };
}

export function job(
  runId: number,
  name: string,
  conclusion: Conclusion,
  startedAt: string | null,
): Job {
  return {
    id: nextId++,
    run_id: runId,
    name,
    status: 'completed',
    conclusion,
    started_at: startedAt,
    completed_at: startedAt,
    html_url: null,
  };
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

/** A fake fetch that answers from a queue and records every call. */
export function fakeFetch(...responses: Array<Response | Error | (() => Response)>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error(`fakeFetch: no response queued for ${String(input)}`);
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  }) as typeof fetch;
  return { impl, calls };
}
