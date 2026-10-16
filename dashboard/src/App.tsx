import { useEffect, useState } from 'react';
import type { ConfigResponse, RunSummary } from '../server/apiTypes';
import { describeError, fetchJson } from './api';
import { RunsTable } from './components/RunsTable';
import { usePolling } from './hooks/usePolling';
import { formatRelative } from './lib/format';

const POLL_MS = 20_000;

const fetchRuns = (signal: AbortSignal) =>
  fetchJson<{ runs: RunSummary[] }>('/api/runs?limit=50', signal).then((r) => r.runs);

/** Re-render every `ms` so relative times ("2 minutes ago") stay current. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function App() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const runs = usePolling(fetchRuns, POLL_MS);
  const now = useNow(10_000);

  useEffect(() => {
    fetchJson<ConfigResponse>('/api/config')
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1 className="header__title">Pipeline Dashboard</h1>
          {config?.repo && (
            <a className="header__repo" href={`https://github.com/${config.repo}/actions`} target="_blank" rel="noreferrer">
              {config.repo} · {config.workflowFile}
            </a>
          )}
        </div>
        <div className="header__status" aria-live="polite">
          <span className={`live-dot ${runs.error ? 'live-dot--stale' : ''}`} aria-hidden="true" />
          {runs.updatedAt ? `Updated ${formatRelative(runs.updatedAt.toISOString(), now)}` : 'Loading…'}
          <button type="button" className="button" onClick={runs.refresh}>
            Refresh
          </button>
        </div>
      </header>

      {runs.error != null && (
        <div className="banner" role="alert">
          {describeError(runs.error)}
          {runs.data && ' Showing the last data received.'}
        </div>
      )}

      <section className="card">
        <h2 className="card__title">Build history</h2>
        <RunsTable runs={runs.data} loading={runs.loading} now={now} />
      </section>
    </div>
  );
}
