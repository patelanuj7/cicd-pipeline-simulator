import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

describe('GET /', () => {
  it('returns a JSON greeting', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ message: expect.any(String) });
  });
});

describe('GET /health', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports ok, the build SHA, and uptime', async () => {
    vi.stubEnv('GIT_SHA', 'abc123');

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.sha).toBe('abc123');
    expect(Number.isInteger(res.body.uptimeSeconds)).toBe(true);
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('falls back to "dev" when GIT_SHA is not set', async () => {
    vi.stubEnv('GIT_SHA', undefined);

    const res = await request(app).get('/health');

    expect(res.body.sha).toBe('dev');
  });
});

describe('unknown routes', () => {
  it('return a JSON 404', async () => {
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found', path: '/does-not-exist' });
  });
});
