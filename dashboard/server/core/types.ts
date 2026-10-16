// The subset of GitHub Actions REST API fields this project uses.
// Full shapes: https://docs.github.com/en/rest/actions/workflow-runs

export type RunStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'waiting'
  | 'requested'
  | 'pending';

export type Conclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'neutral'
  | 'stale'
  | 'startup_failure'
  | null;

export interface WorkflowRun {
  id: number;
  name: string | null;
  display_title?: string;
  head_branch: string | null;
  head_sha: string;
  status: RunStatus | null;
  conclusion: Conclusion;
  run_number: number;
  run_attempt?: number;
  event: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
  html_url: string;
}

export interface JobStep {
  name: string;
  status: string;
  conclusion: Conclusion;
  number: number;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface Job {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: Conclusion;
  started_at: string | null;
  completed_at: string | null;
  html_url: string | null;
  steps?: JobStep[];
}
