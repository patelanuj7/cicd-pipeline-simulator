import type { RunSummary } from '../../server/apiTypes';
import { firstLine, formatDuration, formatRelative, shortSha } from '../lib/format';
import { StatusBadge } from './StatusBadge';

interface Props {
  runs: RunSummary[] | null;
  loading: boolean;
  now: number;
}

const SKELETON_ROWS = 6;

export function RunsTable({ runs, loading, now }: Props) {
  if (!loading && runs !== null && runs.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">No pipeline runs yet</p>
        <p className="empty__hint">Push a commit and it will show up here within about 20 seconds.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="runs">
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Commit</th>
            <th scope="col">SHA</th>
            <th scope="col">Branch</th>
            <th scope="col" className="num">
              Duration
            </th>
            <th scope="col">Started</th>
          </tr>
        </thead>
        <tbody>
          {runs === null
            ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <tr key={i} className="skeleton-row" aria-hidden="true">
                  {Array.from({ length: 6 }, (_, j) => (
                    <td key={j}>
                      <span className="skeleton" />
                    </td>
                  ))}
                </tr>
              ))
            : runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <StatusBadge status={run.status} conclusion={run.conclusion} />
                  </td>
                  <td className="commit">
                    <a href={run.url} target="_blank" rel="noreferrer" className="commit__title" title={run.title}>
                      {firstLine(run.title)}
                    </a>
                    <span className="commit__meta">
                      #{run.runNumber}
                      {run.runAttempt > 1 && ` · attempt ${run.runAttempt}`} · {run.event}
                    </span>
                  </td>
                  <td>
                    <a href={run.commitUrl} target="_blank" rel="noreferrer" className="sha">
                      {shortSha(run.sha)}
                    </a>
                  </td>
                  <td>{run.branch && <span className="branch">{run.branch}</span>}</td>
                  <td className="num">
                    {run.status === 'completed' ? formatDuration(run.durationMs) : <span className="muted">running…</span>}
                  </td>
                  <td>
                    <time dateTime={run.createdAt} title={new Date(run.createdAt).toLocaleString()}>
                      {formatRelative(run.createdAt, now)}
                    </time>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
