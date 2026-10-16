import { describe, expect, it } from 'vitest';
import { firstLine, formatDuration, formatRelative, shortSha } from './format';

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [4_400, '4s'],
    [98_000, '1m 38s'],
    [385_000, '6m 25s'],
    [3_725_000, '1h 2m'],
  ])('%i ms -> %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it.each([null, undefined, -1, Number.NaN])('%s -> em dash', (ms) => {
    expect(formatDuration(ms)).toBe('—');
  });
});

describe('formatRelative', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');

  it.each([
    ['2026-10-16T11:59:30Z', 'just now'],
    ['2026-10-16T11:55:00Z', '5 minutes ago'],
    ['2026-10-16T09:00:00Z', '3 hours ago'],
    ['2026-10-15T12:00:00Z', 'yesterday'],
    ['2026-10-02T12:00:00Z', '2 weeks ago'],
  ])('%s -> %s', (iso, text) => {
    expect(formatRelative(iso, now)).toBe(text);
  });

  it('handles an invalid date', () => {
    expect(formatRelative('not a date', now)).toBe('—');
  });
});

describe('shortSha / firstLine', () => {
  it('shortens a SHA to 7 chars', () => {
    expect(shortSha('0f51fe67dfb0f07dab85845f2d002127fa2868a4')).toBe('0f51fe6');
  });

  it('keeps only the first line of a commit message', () => {
    expect(firstLine('feat: thing\n\nlong body')).toBe('feat: thing');
  });
});
