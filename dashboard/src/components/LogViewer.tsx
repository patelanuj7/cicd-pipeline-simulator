import { useEffect, useRef, useState } from 'react';
import type { LogGroup, ParsedLog } from '../../server/apiTypes';
import { describeError, fetchJson } from '../api';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; log: ParsedLog };

function LogGroupView({ group, firstErrorRef }: { group: LogGroup; firstErrorRef: ((el: HTMLElement | null) => void) | null }) {
  // The first error line of the first failing group is the scroll target.
  const targetIndex = firstErrorRef ? group.lines.findIndex((l) => l.kind === 'error') : -1;
  return (
    // Groups with errors start open; everything else is collapsed to keep the noise down.
    <details className={`log-group ${group.hasError ? 'log-group--error' : ''}`} open={group.hasError}>
      <summary className="log-group__title">
        {group.hasError && (
          <span className="log-group__flag" aria-label="contains errors">
            ✕
          </span>
        )}
        <span className="log-group__name">{group.title}</span>
        <span className="log-group__count">
          {group.lines.length} {group.lines.length === 1 ? 'line' : 'lines'}
        </span>
      </summary>
      <ol className="log-lines">
        {group.lines.map((line, i) => (
          <li
            key={i}
            className={`log-line log-line--${line.kind}`}
            ref={i === targetIndex && firstErrorRef ? firstErrorRef : undefined}
          >
            <span className="log-line__no" aria-hidden="true">
              {i + 1}
            </span>
            <span className="log-line__text">{line.text || ' '}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function LogViewer({ jobId, jobRunning }: { jobId: number; jobRunning: boolean }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const scrolled = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<ParsedLog>(`/api/jobs/${jobId}/logs`, controller.signal)
      .then((log) => setState({ status: 'ready', log }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: describeError(err) });
      });
    return () => controller.abort();
  }, [jobId]);

  if (state.status === 'loading') return <div className="log-status">Loading log…</div>;
  if (state.status === 'error') {
    return (
      <div className="log-status">
        {jobRunning ? 'Logs are available once this job finishes.' : state.message}
      </div>
    );
  }

  const { log } = state;
  const firstErrorGroup = log.groups.findIndex((g) => g.hasError);
  // Jump straight to the first error line, once, after it renders.
  const scrollToError = (el: HTMLElement | null) => {
    if (el && !scrolled.current) {
      scrolled.current = true;
      el.scrollIntoView({ block: 'center' });
    }
  };

  return (
    <div className="log-viewer">
      <div className="log-viewer__summary">
        {log.errorCount > 0 ? (
          <span className="log-viewer__errors">
            {log.errorCount} error{log.errorCount === 1 ? '' : 's'}
          </span>
        ) : (
          <span>No errors</span>
        )}
        <span className="muted"> · {log.groups.length} steps</span>
      </div>
      {log.groups.map((group, i) => (
        <LogGroupView key={i} group={group} firstErrorRef={i === firstErrorGroup ? scrollToError : null} />
      ))}
    </div>
  );
}
