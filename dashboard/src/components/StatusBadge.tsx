import type { Conclusion, RunStatus } from '../../server/apiTypes';

type Tone = 'success' | 'failure' | 'running' | 'neutral';

interface Display {
  label: string;
  tone: Tone;
  icon: string;
}

/** Collapse GitHub's status + conclusion pair into one thing to show. */
export function describeStatus(status: RunStatus | string | null, conclusion: Conclusion): Display {
  if (status !== 'completed') {
    if (status === 'in_progress') return { label: 'Running', tone: 'running', icon: '●' };
    return { label: 'Queued', tone: 'neutral', icon: '○' };
  }
  switch (conclusion) {
    case 'success':
      return { label: 'Passed', tone: 'success', icon: '✓' };
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return { label: conclusion === 'timed_out' ? 'Timed out' : 'Failed', tone: 'failure', icon: '✕' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'neutral', icon: '⊘' };
    case 'skipped':
      return { label: 'Skipped', tone: 'neutral', icon: '–' };
    default:
      return { label: conclusion ?? 'Unknown', tone: 'neutral', icon: '?' };
  }
}

export function StatusBadge({ status, conclusion }: { status: RunStatus | string | null; conclusion: Conclusion }) {
  const { label, tone, icon } = describeStatus(status, conclusion);
  return (
    <span className={`badge badge--${tone}`}>
      <span className="badge__icon" aria-hidden="true">
        {icon}
      </span>
      {label}
    </span>
  );
}
