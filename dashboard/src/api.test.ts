import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, describeError, fetchJson } from './api';

describe('fetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ runs: [] })));
    await expect(fetchJson('/api/runs')).resolves.toEqual({ runs: [] });
  });

  it('throws ApiError with the JSON body on failure', async () => {
    const resetAt = '2026-10-16T15:42:00.000Z';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'limited', resetAt }, { status: 429 })));

    const err = await fetchJson('/api/runs').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isRateLimit).toBe(true);
    expect((err as ApiError).resetAt?.toISOString()).toBe(resetAt);
  });

  it('throws ApiError with a null body when the response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('proxy error', { status: 500 })));
    const err = (await fetchJson('/api/runs').catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(500);
    expect(err.body).toBeNull();
  });
});

describe('describeError', () => {
  it('explains a rate limit with the reset time', () => {
    const err = new ApiError(429, { error: 'limited', resetAt: '2026-10-16T15:42:00.000Z' });
    expect(describeError(err)).toMatch(/^GitHub API rate limit reached\. Updates resume at .+\.$/);
  });

  it('explains a rate limit without a reset time', () => {
    expect(describeError(new ApiError(429, { error: 'limited' }))).toBe(
      'GitHub API rate limit reached. Updates will resume shortly.',
    );
  });

  it('explains an upstream GitHub failure', () => {
    expect(describeError(new ApiError(502, { error: 'GitHub API error' }))).toMatch(/GitHub API is not responding/);
  });

  it('treats a non-JSON error or network failure as the API being unreachable', () => {
    expect(describeError(new ApiError(500, null))).toMatch(/Cannot reach the dashboard API/);
    expect(describeError(new TypeError('Failed to fetch'))).toMatch(/Cannot reach the dashboard API/);
  });

  it('shows other API errors with their status', () => {
    expect(describeError(new ApiError(400, { error: 'limit must be a positive integer' }))).toBe(
      'Dashboard API error (400): limit must be a positive integer',
    );
  });
});
