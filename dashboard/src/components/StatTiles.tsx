import type { Stats } from '../../server/apiTypes';
import { formatDuration } from '../lib/format';

interface Tile {
  label: string;
  value: string;
  detail: string;
}

function tiles(stats: Stats): Tile[] {
  const decided = stats.succeeded + stats.failed;
  return [
    {
      label: 'Pass rate',
      value: stats.passRate == null ? '—' : `${Math.round(stats.passRate * 100)}%`,
      detail: decided === 0 ? 'No finished runs yet' : `${stats.succeeded} passed · ${stats.failed} failed`,
    },
    {
      label: 'Total runs',
      value: String(stats.total),
      detail:
        [
          stats.inProgress > 0 && `${stats.inProgress} running`,
          stats.cancelled > 0 && `${stats.cancelled} cancelled`,
        ]
          .filter(Boolean)
          .join(' · ') || 'All finished',
    },
    { label: 'Median duration', value: formatDuration(stats.durationMs.p50), detail: 'p50 of completed runs' },
    { label: 'Slowest 5%', value: formatDuration(stats.durationMs.p95), detail: 'p95 of completed runs' },
    {
      label: 'Flaky commits',
      value: String(stats.flakyShas.length),
      detail: stats.flakyShas.length === 0 ? 'None detected' : 'Failed, then passed on the same commit',
    },
  ];
}

export function StatTiles({ stats }: { stats: Stats | null }) {
  if (!stats) {
    return (
      <div className="tiles" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="tile">
            <span className="skeleton" style={{ width: '50%' }} />
            <span className="skeleton tile__value-skeleton" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <dl className="tiles">
      {tiles(stats).map((t) => (
        <div key={t.label} className="tile">
          <dt className="tile__label">{t.label}</dt>
          <dd className="tile__value">{t.value}</dd>
          <dd className="tile__detail">{t.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
