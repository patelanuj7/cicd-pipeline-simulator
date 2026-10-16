import { describe, expect, it } from 'vitest';
import { parseLog } from '../logs.js';

// Shaped like a real GitHub Actions job log (timestamps, BOM, CRLF, ANSI colors).
const SAMPLE = [
  '﻿2026-10-15T12:00:00.1000000Z Current runner version: \'2.329.0\'',
  '2026-10-15T12:00:00.2000000Z ##[group]Operating System',
  '2026-10-15T12:00:00.3000000Z Ubuntu',
  '2026-10-15T12:00:00.4000000Z ##[endgroup]',
  '2026-10-15T12:00:01.0000000Z ##[group]Run npm test',
  '2026-10-15T12:00:01.1000000Z \u001b[36;1mnpm test\u001b[0m',
  '2026-10-15T12:00:01.2000000Z ##[endgroup]',
  '2026-10-15T12:00:02.0000000Z [command]/usr/bin/npm test',
  '2026-10-15T12:00:03.0000000Z \u001b[31m FAIL \u001b[39m test/app.test.js',
  '2026-10-15T12:00:03.5000000Z ##[warning]Node 20 is deprecated',
  '2026-10-15T12:00:04.0000000Z ##[error]Process completed with exit code 1.',
  '',
].join('\r\n');

describe('parseLog', () => {
  const parsed = parseLog(SAMPLE);

  it('splits the log into groups, with pre-group lines under "Set up"', () => {
    expect(parsed.groups.map((g) => g.title)).toEqual(['Set up', 'Operating System', 'Run npm test']);
  });

  it('strips the BOM, timestamps and ANSI codes', () => {
    expect(parsed.groups[0]!.lines[0]!.text).toBe("Current runner version: '2.329.0'");
    const step = parsed.groups[2]!;
    expect(step.lines[0]!.text).toBe('npm test');
    // Matching the ESC control character is the point: no ANSI codes may survive.
    // eslint-disable-next-line no-control-regex
    expect(step.lines.map((l) => l.text).join('\n')).not.toMatch(/\u001b|\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps step output after ##[endgroup] in the same step', () => {
    const step = parsed.groups[2]!;
    expect(step.lines.map((l) => l.kind)).toEqual(['normal', 'command', 'normal', 'warning', 'error']);
    expect(step.lines[1]!.text).toBe('/usr/bin/npm test');
    expect(step.lines[2]!.text).toBe(' FAIL  test/app.test.js');
  });

  it('marks groups with errors and counts them', () => {
    expect(parsed.groups.map((g) => g.hasError)).toEqual([false, false, true]);
    expect(parsed.errorCount).toBe(1);
    expect(parsed.groups[2]!.lines.at(-1)).toEqual({
      text: 'Process completed with exit code 1.',
      kind: 'error',
    });
  });

  it('handles an empty log', () => {
    expect(parseLog('')).toEqual({ groups: [], errorCount: 0 });
  });

  it('puts an error before any group into "Set up"', () => {
    const p = parseLog('##[error]Runner failed to start\n');
    expect(p.groups).toEqual([
      { title: 'Set up', hasError: true, lines: [{ text: 'Runner failed to start', kind: 'error' }] },
    ]);
  });

  it('keeps unknown markers as plain text and keeps blank lines inside output', () => {
    const p = parseLog('##[group]Step\n##[section]Old style\n\nend\n');
    expect(p.groups[0]!.lines).toEqual([
      { text: '##[section]Old style', kind: 'normal' },
      { text: '', kind: 'normal' },
      { text: 'end', kind: 'normal' },
    ]);
  });

  it('gives a title to an empty group header', () => {
    expect(parseLog('##[group]\nx').groups[0]!.title).toBe('Untitled step');
  });
});
