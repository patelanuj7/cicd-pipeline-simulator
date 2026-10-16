import { useEffect, useState } from 'react';
import type { ConfigResponse, RunSummary, Stats } from '../server/apiTypes';
import { describeError, fetchJson } from './api';
import { DailyChart } from './components/charts/DailyChart';
import { DurationChart } from './components/charts/DurationChart';
import { StageFailuresChart } from './components/charts/StageFailuresChart';
import { RunsTable } from './components/RunsTable';
import { StatTiles } from './components/StatTiles';
import { useChartTheme } from './hooks/useChartTheme';
import { usePolling } from './hooks/usePolling';
import { formatRelative } from './lib/format';

const POLL_MS = 20_000;

// Group "runs per day" by the viewer's own calendar days.
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const fetchRuns = (signal: AbortSignal) =>
  fetchJson<{ runs: RunSummary[] }>('/api/runs?limit=50', signal).then((r) => r.runs);

const fetchStats = (signal: AbortSignal) =>
  fetchJson<Stats>(`/api/stats?timeZone=${encodeURIComponent(TIME_ZONE)}`, signal);

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
  const stats = usePolling(fetchStats, POLL_MS);
  const theme = useChartTheme();
  const now = useNow(10_000);
  const error = runs.error ?? stats.error;
  const refreshAll = () => {
    runs.refresh();
    stats.refresh();
  };

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
          <span className={`live-dot ${error ? 'live-dot--stale' : ''}`} aria-hidden="true" />
          {runs.updatedAt ? `Updated ${formatRelative(runs.updatedAt.toISOString(), now)}` : 'Loading…'}
          <button type="button" className="button" onClick={refreshAll}>
            Refresh
          </button>
        </div>
      </header>

      {error != null && (
        <div className="banner" role="alert">
          {describeError(error)}
          {(runs.data || stats.data) && ' Showing the last data received.'}
        </div>
      )}

      <StatTiles stats={stats.data} />

      {stats.data && runs.data && (
        <div className="charts">
          <DailyChart daily={stats.data.daily} theme={theme} timeZone={TIME_ZONE} />
          <StageFailuresChart stageFailures={stats.data.stageFailures} failedRuns={stats.data.failed} theme={theme} />
          <DurationChart runs={runs.data} theme={theme} />
        </div>
      )}

      <section className="card">
        <h2 className="card__title">Build history</h2>
        <RunsTable runs={runs.data} loading={runs.loading} now={now} />
      </section>
    </div>
  );
}
