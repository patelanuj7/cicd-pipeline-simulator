/** Any non-success response from the GitHub API (after retries). */
export class GitHubApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

/** The token is out of requests. `resetAt` says when it can try again. */
export class RateLimitError extends GitHubApiError {
  readonly resetAt: Date;

  constructor(resetAt: Date, message = 'GitHub API rate limit exceeded') {
    super(429, message);
    this.name = 'RateLimitError';
    this.resetAt = resetAt;
  }
}
