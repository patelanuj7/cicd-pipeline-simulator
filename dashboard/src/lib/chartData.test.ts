import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../server/apiTypes';
import { dailyRows, dayLabel, durationRows, stageRows } from './chartData';

function run(overrides: Partial<RunSummary>): RunSummary {
  return {
    id: 1,
    runNumber: 1,
    runAttempt: 1,
    title: 't',
    branch: 'main',
    sha: 'abc',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-10-16T12:00:00Z',
    updatedAt: '2026-10-16T12:01:00Z',
    durationMs: 60_000,
    url: 'u',
    commitUrl: 'c',
    ...overrides,
  };
}

describe('dayLabel', () => {
  it('formats the calendar date without shifting it by time zone', () => {
    expect(dayLabel('2026-10-16')).toBe('Oct 16');
    expect(dayLabel('2026-01-01')).toBe('Jan 1');
  });
});

describe('dailyRows', () => {
  it('maps succeeded/failed to passed/failed with labels', () => {
    expect(dailyRows([{ date: '2026-10-16', succeeded: 5, failed: 1, passRate: 5 / 6 }])).toEqual([
      { date: '2026-10-16', label: 'Oct 16', passed: 5, failed: 1 },
    ]);
  });
});

describe('durationRows', () => {
  it('keeps completed runs with a duration, oldest first, in minutes', () => {
    const rows = durationRows([
      run({ runNumber: 3, durationMs: 90_000 }),
      run({ runNumber: 4, status: 'in_progress', durationMs: null }),
      run({ runNumber: 2, durationMs: null }),
      run({ runNumber: 1, durationMs: 30_000, conclusion: 'failure' }),
    ]);
    expect(rows.map((r) => [r.label, r.minutes, r.conclusion])).toEqual([
      ['#1', 0.5, 'failure'],
      ['#3', 1.5, 'success'],
    ]);
  });
});

describe('stageRows', () => {
  it('lists every pipeline stage in order, with zeros', () => {
    expect(stageRows({ deploy: 1 })).toEqual([
      { stage: 'lint', failures: 0 },
      { stage: 'test', failures: 0 },
      { stage: 'build', failures: 0 },
      { stage: 'deploy', failures: 1 },
    ]);
  });

  it('appends unknown stages after the known ones', () => {
    expect(stageRows({ zeta: 2, alpha: 1 }).map((r) => r.stage)).toEqual([
      'lint',
      'test',
      'build',
      'deploy',
      'alpha',
      'zeta',
    ]);
  });
});
