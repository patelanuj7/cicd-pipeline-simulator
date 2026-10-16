// Response shapes of the dashboard API, shared by the server (routes.ts) and the
// React app (src/). Type-only: nothing here exists at runtime.
import type { Conclusion, RunStatus } from './core/types.js';

export type { Stats, DailyStat, ParsedLog, LogGroup, LogLine, LogLineKind } from './core/index.js';
export type { Conclusion, RunStatus };

export interface ConfigResponse {
  repo: string;
  workflowFile: string;
}

export interface RunSummary {
  id: number;
  runNumber: number;
  runAttempt: number;
  title: string;
  branch: string | null;
  sha: string;
  event: string;
  status: RunStatus | null;
  conclusion: Conclusion;
  createdAt: string;
  updatedAt: string;
  durationMs: number | null;
  url: string;
  commitUrl: string;
}

export interface StepSummary {
  number: number;
  name: string;
  status: string;
  conclusion: Conclusion;
}

export interface JobSummary {
  id: number;
  runId: number;
  name: string;
  status: string;
  conclusion: Conclusion;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  url: string | null;
  steps: StepSummary[];
}

export interface ApiErrorBody {
  error: string;
  resetAt?: string;
  upstreamStatus?: number;
  message?: string;
}
