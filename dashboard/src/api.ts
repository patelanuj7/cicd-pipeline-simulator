import type { ApiErrorBody } from '../server/apiTypes';

/** A non-2xx response from our own /api. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }

  get resetAt(): Date | null {
    return this.body?.resetAt ? new Date(this.body.resetAt) : null;
  }
}

export async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

/** A user-facing sentence for any error thrown by fetchJson. */
export function describeError(err: unknown): string {
  // No JSON body means our API didn't answer (e.g. the dev proxy's bare 500 when
  // the server is down), as opposed to our API reporting an error.
  if (err instanceof ApiError && err.body !== null) {
    if (err.isRateLimit) {
      const at = err.resetAt;
      return at
        ? `GitHub API rate limit reached. Updates resume at ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
        : 'GitHub API rate limit reached. Updates will resume shortly.';
    }
    if (err.status === 502) return 'GitHub API is not responding as expected. Retrying automatically.';
    return `Dashboard API error (${err.status}): ${err.message}`;
  }
  return 'Cannot reach the dashboard API. Is the server running?';
}
