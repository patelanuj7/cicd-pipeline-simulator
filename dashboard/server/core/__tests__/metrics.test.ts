import { describe, expect, it } from 'vitest';
import { computeStats, percentile, runDurationMs } from '../metrics.js';
import { job, run } from './fixtures.js';

const minutes = (m: number) => m * 60_000;

describe('computeStats: counts and pass rate', () => {
  it('handles an empty repo', () => {
    const s = computeStats([]);
    expect(s).toMatchObject({ total: 0, completed: 0, passRate: null, flakyShas: [], daily: [] });
    expect(s.durationMs).toEqual({ p50: null, p95: null, avg: null });
  });

  it('counts each outcome and leaves cancelled runs out of the pass rate', () => {
    const s = computeStats([
      run({ conclusion: 'success' }),
      run({ conclusion: 'success' }),
      run({ conclusion: 'success' }),
      run({ conclusion: 'failure' }),
      run({ conclusion: 'timed_out' }),
      run({ conclusion: 'cancelled' }),
      run({ conclusion: 'skipped' }),
      run({ status: 'in_progress', conclusion: null }),
    ]);
    expect(s).toMatchObject({
      total: 8,
      completed: 7,
      succeeded: 3,
      failed: 2,
      cancelled: 1,
      inProgress: 1,
    });
    expect(s.passRate).toBeCloseTo(3 / 5);
  });

  it('treats queued and waiting runs as in progress', () => {
    const s = computeStats([run({ status: 'queued', conclusion: null }), run({ status: 'waiting', conclusion: null })]);
    expect(s.inProgress).toBe(2);
    expect(s.passRate).toBeNull();
  });
});

describe('durations', () => {
  it('uses run_started_at so re-runs measure the latest attempt', () => {
    const r = run({
      created_at: '2026-10-15T10:00:00Z',
      run_started_at: '2026-10-15T11:00:00Z',
      updated_at: '2026-10-15T11:03:00Z',
    });
    expect(runDurationMs(r)).toBe(minutes(3));
  });

  it('falls back to created_at and ignores bad timestamps', () => {
    expect(runDurationMs(run({ run_started_at: undefined, created_at: '2026-10-15T12:00:00Z' }))).toBe(minutes(2));
    expect(runDurationMs(run({ updated_at: 'garbage' }))).toBeNull();
    expect(runDurationMs(run({ updated_at: '2026-10-15T11:00:00Z' }))).toBeNull(); // ends before it starts
  });

  it('computes p50, p95 and average over completed runs only', () => {
    const at = (m: number) => ({
      run_started_at: '2026-10-15T12:00:00Z',
      updated_at: new Date(Date.parse('2026-10-15T12:00:00Z') + minutes(m)).toISOString(),
    });
    const runs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((m) => run(at(m)));
    runs.push(run({ ...at(100), status: 'in_progress', conclusion: null }));
    const s = computeStats(runs);
    expect(s.durationMs.p50).toBe(minutes(5));
    expect(s.durationMs.p95).toBe(minutes(10));
    expect(s.durationMs.avg).toBe(minutes(5.5));
  });
});

describe('percentile (nearest rank)', () => {
  it.each([
    [[], 50, null],
    [[7], 50, 7],
    [[7], 95, 7],
    [[1, 2], 50, 1],
    [[1, 2, 3, 4], 50, 2],
    [[1, 2, 3, 4], 75, 3],
    [[1, 2, 3, 4], 100, 4],
    [[1, 2, 3, 4], 0, 1],
  ])('percentile(%j, %i) = %j', (sorted, p, expected) => {
    expect(percentile(sorted, p)).toBe(expected);
  });
});

describe('stageFailures', () => {
  it('blames the first failing job and ignores skipped ones', () => {
    const a = run({ conclusion: 'failure' });
    const b = run({ conclusion: 'failure' });
    const c = run({ conclusion: 'failure' });
    const ok = run({ conclusion: 'success' });
    const jobs = new Map([
      [a.id, [
        job(a.id, 'lint', 'success', '2026-10-15T12:00:00Z'),
        job(a.id, 'test', 'failure', '2026-10-15T12:01:00Z'),
        job(a.id, 'build', 'skipped', null),
      ]],
      // Listed out of order: build failed later than test, so test is still the first failure.
      [b.id, [
        job(b.id, 'build', 'failure', '2026-10-15T12:05:00Z'),
        job(b.id, 'test', 'failure', '2026-10-15T12:01:00Z'),
      ]],
      [c.id, [job(c.id, 'deploy', 'timed_out', '2026-10-15T12:09:00Z')]],
      [ok.id, [job(ok.id, 'lint', 'failure', '2026-10-15T12:00:00Z')]], // run passed: ignore
    ]);
    expect(computeStats([a, b, c, ok], jobs).stageFailures).toEqual({ test: 2, deploy: 1 });
  });

  it('skips failed runs whose jobs were not loaded', () => {
    expect(computeStats([run({ conclusion: 'failure' })]).stageFailures).toEqual({});
  });
});

describe('flakyShas', () => {
  it('flags a commit that failed and then passed with no code change', () => {
    const s = computeStats([
      run({ head_sha: 'flaky', conclusion: 'failure', created_at: '2026-10-15T12:00:00Z' }),
      run({ head_sha: 'flaky', conclusion: 'success', created_at: '2026-10-15T12:10:00Z' }),
      // Passed first, then failed: that's a regression or an environment issue, not flaky.
      run({ head_sha: 'broke', conclusion: 'success', created_at: '2026-10-15T12:00:00Z' }),
      run({ head_sha: 'broke', conclusion: 'failure', created_at: '2026-10-15T12:10:00Z' }),
      run({ head_sha: 'clean', conclusion: 'success' }),
    ]);
    expect(s.flakyShas).toEqual(['flaky']);
  });

  it('flags a run that only succeeded on a re-run', () => {
    const s = computeStats([run({ head_sha: 'rerun', run_attempt: 2, conclusion: 'success' })]);
    expect(s.flakyShas).toEqual(['rerun']);
  });
});

describe('daily', () => {
  it('groups by day, oldest first, with a per-day pass rate', () => {
    const s = computeStats([
      run({ created_at: '2026-10-14T09:00:00Z', conclusion: 'success' }),
      run({ created_at: '2026-10-15T09:00:00Z', conclusion: 'failure' }),
      run({ created_at: '2026-10-15T10:00:00Z', conclusion: 'success' }),
      run({ created_at: '2026-10-15T11:00:00Z', conclusion: 'cancelled' }),
    ]);
    expect(s.daily).toEqual([
      { date: '2026-10-14', succeeded: 1, failed: 0, passRate: 1 },
      { date: '2026-10-15', succeeded: 1, failed: 1, passRate: 0.5 },
    ]);
  });

  it('uses the requested time zone for day boundaries', () => {
    // 02:00 UTC on the 16th is still 10pm on the 15th in New York.
    const runs = [run({ created_at: '2026-10-16T02:00:00Z' })];
    expect(computeStats(runs).daily[0]!.date).toBe('2026-10-16');
    expect(computeStats(runs, new Map(), { timeZone: 'America/New_York' }).daily[0]!.date).toBe('2026-10-15');
  });
});
