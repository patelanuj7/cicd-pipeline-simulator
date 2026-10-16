export type LogLineKind = 'normal' | 'command' | 'error' | 'warning' | 'notice' | 'debug';

export interface LogLine {
  text: string;
  kind: LogLineKind;
}

export interface LogGroup {
  /** The step header, e.g. "Run npm ci". Lines before any group go under "Set up". */
  title: string;
  lines: LogLine[];
  hasError: boolean;
}

export interface ParsedLog {
  groups: LogGroup[];
  errorCount: number;
}

// Each raw line starts like: 2026-10-15T09:12:33.1234567Z
const TIMESTAMP = /^﻿?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
// Terminal color/cursor codes, e.g. \x1b[31m (red) or \x1b[0m (reset).
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const MARKER = /^##\[(\w+)\](.*)$/;

const KIND_BY_MARKER: Record<string, LogLineKind> = {
  error: 'error',
  warning: 'warning',
  notice: 'notice',
  debug: 'debug',
  command: 'command',
};

/**
 * Turns a raw GitHub Actions job log into collapsible groups.
 *
 * In Actions logs, "##[group]Run npm ci" opens a step header and "##[endgroup]" closes
 * the header block. The step's output follows *after* the endgroup, so a group here
 * runs from one "##[group]" until the next one.
 */
export function parseLog(raw: string): ParsedLog {
  const groups: LogGroup[] = [];
  let current: LogGroup | null = null;
  let errorCount = 0;

  const ensureGroup = (): LogGroup => {
    if (!current) {
      current = { title: 'Set up', lines: [], hasError: false };
      groups.push(current);
    }
    return current;
  };

  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  // A trailing newline produces one empty last element; drop it.
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  for (const rawLine of lines) {
    const line = rawLine.replace(TIMESTAMP, '').replace(ANSI, '');
    const marker = MARKER.exec(line);

    if (marker) {
      const [, name = '', rest = ''] = marker;
      if (name === 'group') {
        current = { title: rest.trim() || 'Untitled step', lines: [], hasError: false };
        groups.push(current);
        continue;
      }
      if (name === 'endgroup') continue;

      const kind = KIND_BY_MARKER[name];
      if (kind) {
        const group = ensureGroup();
        group.lines.push({ text: rest, kind });
        if (kind === 'error') {
          group.hasError = true;
          errorCount++;
        }
        continue;
      }
      // Unknown marker: keep it as plain text so nothing is silently lost.
    }

    if (line.startsWith('[command]')) {
      ensureGroup().lines.push({ text: line.slice('[command]'.length), kind: 'command' });
      continue;
    }

    ensureGroup().lines.push({ text: line, kind: 'normal' });
  }

  return { groups, errorCount };
}
