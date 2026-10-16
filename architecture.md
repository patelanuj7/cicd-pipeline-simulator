# CI/CD Pipeline Simulator: Architecture & Build Plan

> **For Claude Code:** Read this whole file before doing anything. Work on **one phase at a time**. At the end of each phase, run every "Done when" check and show the output; once they pass, commit and push (see rule 1 in section 4), then **stop**. Do not start the next phase on your own.

---

## 1. What we're building

A small but real CI/CD system with three parts:

1. **`service/`**: a tiny Node/Express API. It is the "product" the pipeline ships. It exposes `/health`, which reports the git SHA it was built from.
2. **The pipeline**: a GitHub Actions workflow with **4 stages** (lint → test → build → deploy) that runs on every push. It builds a Docker image, pushes it to GitHub Container Registry (GHCR), deploys it, and then runs a Python health check that confirms the *new* version is live.
3. **`dashboard/`**: a React app plus a small Express backend. The backend calls the GitHub API (so the token never reaches the browser). The UI shows build history, pass/fail rates, stage failure breakdown, durations, and step logs.

### Resume bullets this project must make true

| Bullet | Proven by |
|---|---|
| 4-stage pipeline (GitHub Actions + Docker): lint, test, build, deploy on every push | `.github/workflows/pipeline.yml`, green runs in the Actions tab |
| Bash and Python scripts for test execution and health checks; release steps reduced by 80% | `scripts/run-tests.sh`, `scripts/healthcheck.py`, `docs/release-steps.md` (before vs. after count) |
| React dashboard on the GitHub API: build history, pass/fail rates, logs | `dashboard/`, deployed URL in README |

---

## 2. Repo layout

```
cicd-pipeline-simulator/
├── .github/workflows/pipeline.yml   # the 4-stage pipeline
├── service/                         # app the pipeline ships
│   ├── src/app.js                   # Express app (exported, testable)
│   ├── src/server.js                # starts the server
│   ├── test/app.test.js
│   ├── Dockerfile
│   └── package.json
├── scripts/
│   ├── run-tests.sh                 # runs all test suites, writes JUnit reports
│   ├── healthcheck.py               # polls /health with retries, verifies SHA
│   └── test_healthcheck.py          # pytest tests for healthcheck.py
├── dashboard/
│   ├── server/                      # Express API (holds the GitHub token)
│   │   ├── core/                    # pure logic, no Express imports (heavily tested)
│   │   │   ├── githubClient.ts      # fetch wrapper: pagination, ETag cache, rate limits
│   │   │   ├── metrics.ts           # pass rate, durations, stage failures, flaky runs
│   │   │   └── logs.ts              # parses raw Actions logs into groups/lines/errors
│   │   ├── routes.ts                # /api/runs, /api/stats, /api/runs/:id/jobs, /api/jobs/:id/logs
│   │   └── index.ts                 # serves API + built React app
│   ├── src/                         # React (Vite + TypeScript)
│   └── package.json
├── docs/release-steps.md            # manual vs. automated release, step counts
├── package.json                     # npm workspaces: service, dashboard
├── .gitattributes                   # forces LF line endings on .sh/.py (Windows!)
├── architecture.md                  # this file
└── README.md
```

### Tech choices

- **Node 24**, npm workspaces, ESLint 10 (flat config), Vitest for JS/TS tests.
- **service:** Express 5, plain JavaScript (ES modules).
- **dashboard:** Vite + React + TypeScript; Recharts for charts; Express backend run with `tsx` in dev, compiled with `tsc` for prod.
- **scripts:** Bash (runs in Git Bash locally, Ubuntu in CI) and Python 3.12 standard library only (`urllib`), tested with pytest.
- **Docker:** multi-stage build, `node:24-alpine`, runs as non-root user, `HEALTHCHECK` instruction.
- **Registry:** GHCR (`ghcr.io/<user>/cicd-pipeline-simulator-service`), uses the built-in `GITHUB_TOKEN`; no extra secrets.

---

## 3. How the pieces connect

```
git push
   │
   ▼
GitHub Actions: pipeline.yml
   ├─ lint    : npm ci → npm run lint (all workspaces)
   ├─ test    : scripts/run-tests.sh → JUnit XML uploaded as artifact        (needs: lint)
   ├─ build   : docker build --build-arg GIT_SHA=$GITHUB_SHA → push to GHCR  (needs: test)
   └─ deploy  : main branch only → trigger host deploy (secret DEPLOY_HOOK_URL)
                → python scripts/healthcheck.py --url $SERVICE_URL --expect-sha $GITHUB_SHA
                → job FAILS if the new version isn't healthy in time        (needs: build)

Dashboard backend ── GitHub REST API (token: fine-grained PAT, Actions: read)
   │   GET /repos/{o}/{r}/actions/runs
   │   GET /repos/{o}/{r}/actions/runs/{id}/jobs
   │   GET /repos/{o}/{r}/actions/jobs/{id}/logs   (302 → download; must be fetched server-side)
   ▼
React UI: runs table · pass-rate & duration charts · stage-failure breakdown · log viewer
```

**Key design decisions**

- **Token stays server-side.** The browser never sees the GitHub token. The logs endpoint also redirects to a storage URL that browsers can't fetch cross-origin, so a backend is required anyway.
- **ETag caching.** The client sends `If-None-Match`. A `304 Not Modified` reply doesn't count against the rate limit, so the UI can poll every 15–30s cheaply.
- **Health check proves the deploy, not just uptime.** `/health` returns `{ status, sha, uptimeSeconds }`. `healthcheck.py` keeps polling until `sha` matches the commit being deployed, so it catches "old container still serving" and slow cold starts.
- **Deploy is host-agnostic.** The deploy job only needs two secrets/vars: `DEPLOY_HOOK_URL` (POST to trigger a deploy) and `SERVICE_URL`. The host is chosen separately (see Phase 8).
- **Core logic is pure.** Everything in `dashboard/server/core/` takes data in and returns data out (fetch is injected), so it can be unit tested without network access.

### `dashboard/server/core` contract (provided in the starter zip, already tested)

```ts
// githubClient.ts
createGitHubClient({ token, owner, repo, fetchImpl?, sleepImpl?, maxRetries?, cacheSize? }) => {
  listWorkflowRuns({ perPage?, maxPages?, branch?, workflowFile? }): Promise<WorkflowRun[]>
  listJobs(runId: number): Promise<Job[]>
  getJobLogs(jobId: number): Promise<string>
}
// throws RateLimitError { resetAt: Date } and GitHubApiError { status, message }

// metrics.ts
computeStats(runs: WorkflowRun[], jobsByRun?: Map<number, Job[]>, { timeZone? }) => {
  total, completed, succeeded, failed, cancelled, inProgress,
  passRate,                       // succeeded / (succeeded + failed), 0..1, null if none
  durationMs: { p50, p95, avg },  // completed runs only
  stageFailures: Record<string, number>,   // first failing job per failed run
  flakyShas: string[],            // same commit: failed then later passed, or passed only on re-run
  daily: { date, succeeded, failed, passRate }[]   // oldest first, grouped in timeZone (default UTC)
}

// logs.ts
parseLog(raw: string) => {
  groups: { title, lines: { text, kind }[], hasError }[],   // kind: normal|command|error|warning|notice|debug
  errorCount
}
// strips BOM, ANSI codes and timestamps; a group runs from one ##[group] to the next
// (step output comes AFTER ##[endgroup], so it stays with its step)
```

Import everything from `server/core/index.ts`. Tests live in `server/core/__tests__/` (50 tests; run with `npm test -w dashboard`).

---

## 4. Rules for Claude Code

1. Do one phase at a time. When every Done-when check passes, commit with the phase's commit message and push, then summarize what you built and stop. If a check needs the human to look at something (Docker status, the Actions tab, GitHub Packages, Render), ask them to confirm before committing.
2. Show the exact commands to run on **Windows** (PowerShell or Git Bash; say which).
3. Never commit secrets. Tokens go in `.env` (git-ignored) locally and GitHub Secrets in CI. Provide `.env.example`.
4. Don't change `dashboard/server/core/` without updating its tests and running them.
5. Prefer small files and clear names over cleverness. Explain anything non-obvious in a short comment.
6. Use current major versions of GitHub Actions (`actions/checkout`, `actions/setup-node`, `docker/*`). Check before pinning.
7. If a check fails, fix it before moving on. Don't skip or weaken a test to make it pass.

---

## 5. Prerequisites (one-time, on Windows)

- Git (with Git Bash), Node 24, a GitHub account.
- **Python 3.12+** from python.org (tick "Add to PATH"), then `pip install pytest`.
- **Docker Desktop** with the WSL 2 backend enabled. Verify: `docker run hello-world`.
- An empty GitHub repo named `cicd-pipeline-simulator`.

---

## 6. Build phases

Each phase ends with a commit. Commit messages use Conventional Commits.

### Phase 0: Scaffold (starter zip) — done by the human, see README "Getting started"
- Unzip the starter, `npm install`, `git init`, add the GitHub remote (`https://github.com/patelanuj7/cicd-pipeline-simulator.git`).
- **Done when:** `npm install` succeeds; `npm test -w dashboard` passes (50 core tests); `npm run typecheck` passes; `git status` shows no `node_modules`.
- **Commit:** `chore: scaffold monorepo with tested dashboard core`

### Phase 1: Service app
- Express app with `GET /` (JSON greeting), `GET /health` (`{ status: "ok", sha: process.env.GIT_SHA ?? "dev", uptimeSeconds }`), and a 404 handler. `app.js` exports the app; `server.js` listens on `PORT` (default 3000).
- Vitest + supertest tests for all three routes.
- **Done when:** `npm test -w service` passes; `npm start -w service` then `curl http://localhost:3000/health` returns JSON.
- **Commit:** `feat(service): add express app with health endpoint and tests`

### Phase 2: Linting
- ESLint 10 flat config at the root covering both workspaces; root script `npm run lint`.
- **Done when:** `npm run lint` exits 0; adding an unused variable makes it fail (then remove it).
- **Commit:** `chore: add eslint flat config for all workspaces`

### Phase 3: Dockerize the service
- Multi-stage `service/Dockerfile` on `node:24-alpine`; `ARG GIT_SHA` → `ENV GIT_SHA`; non-root user; `HEALTHCHECK` calling `/health`; `.dockerignore`.
- **Done when:** `docker build -t svc --build-arg GIT_SHA=abc123 service` succeeds; `docker run -p 3000:3000 svc`, and `/health` shows `"sha":"abc123"`; `docker ps` shows `(healthy)` after ~30s.
- **Commit:** `feat(service): add multi-stage dockerfile with healthcheck`

### Phase 4: Test runner script
- `scripts/run-tests.sh`: `set -euo pipefail`; runs service tests, dashboard tests, and pytest; writes JUnit XML to `reports/`; prints a summary; non-zero exit if any suite fails.
- Add `.gitattributes` rule `*.sh text eol=lf` and mark executable: `git update-index --chmod=+x scripts/run-tests.sh`.
- **Done when:** `bash scripts/run-tests.sh` in Git Bash passes and creates `reports/*.xml`; breaking one test makes the script exit non-zero.
- **Commit:** `feat(scripts): add bash test runner with junit reports`

### Phase 5: Pipeline stages 1–2 (lint, test)
- `.github/workflows/pipeline.yml`, triggered on `push` and `pull_request`. Jobs `lint` and `test` (`needs: lint`), Node 24 with npm cache, Python 3.12. Upload `reports/` as an artifact. Add `concurrency` to cancel superseded runs on the same branch.
- **Done when:** push → both jobs green in the Actions tab; the JUnit artifact is downloadable.
- **Commit:** `ci: add lint and test stages`

### Phase 6: Pipeline stage 3 (build & push image)
- `build` job (`needs: test`): buildx, login to GHCR with `GITHUB_TOKEN` (`permissions: packages: write`), tags `sha-<short>` and `latest` (main only), `GIT_SHA` build arg, GitHub Actions layer cache. On PRs: build but don't push.
- **Done when:** push to main → image appears under the repo's Packages; `docker pull` of the `sha-` tag works.
- **Commit:** `ci: build and push service image to ghcr`

### Phase 7: Health check script
- `scripts/healthcheck.py` (standard library only): args `--url`, `--expect-sha`, `--timeout` (default 300s), `--interval` (default 5s). Polls `/health` with exponential backoff (cap 30s); succeeds only when `status == "ok"` and `sha` matches (prefix match allowed); clear log line per attempt; exit 0/1.
- `scripts/test_healthcheck.py`: pytest tests using a local `http.server` fake for success, wrong SHA then right SHA, timeout, and connection refused.
- **Done when:** `pytest scripts` passes; running it against the local Docker container from Phase 3 succeeds with `--expect-sha abc123` and fails with `--expect-sha nope`.
- **Commit:** `feat(scripts): add python health check with sha verification`

### Phase 8: Pipeline stage 4 (deploy + verify)
- Host: **Render** (free web service, "Existing Image" source). See README "Deployment" for the one-time setup. Make the GHCR package public first so Render can pull it without credentials.
- `deploy` job (`needs: build`, `if: github.ref == 'refs/heads/main'`, `environment: production`): POST to `secrets.DEPLOY_HOOK_URL` with `&imgURL=<url-encoded ghcr.io/patelanuj7/cicd-pipeline-simulator-service:sha-<short>>` so Render deploys this exact build, then `python scripts/healthcheck.py --url ${{ vars.SERVICE_URL }} --expect-sha ${{ github.sha }}`. The default 300s timeout covers Render's ~1 minute cold start.
- **Done when:** push to main → all 4 stages green; the public `/health` shows the new SHA; deliberately breaking `/health` makes the deploy job fail.
- **Commit:** `ci: add deploy stage with post-deploy health verification`

### Phase 9: Dashboard backend API
- `dashboard/server/index.ts` + `routes.ts` wrapping the core: `GET /api/runs`, `GET /api/stats`, `GET /api/runs/:id/jobs`, `GET /api/jobs/:id/logs` (returns `parseLog` output). Config from `.env`: `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`. Map `RateLimitError` → 429 with reset time; other API errors → 502. Route tests with an injected fake client.
- **Done when:** `npm test -w dashboard` passes; `npm run dev:server -w dashboard`, then `curl localhost:8787/api/stats` shows real numbers for your repo.
- **Commit:** `feat(dashboard): add express api over github actions data`

### Phase 10: Runs table UI
- Vite React app; dev proxy `/api` → `:8787`. Runs table: status badge, commit message, short SHA (linked), branch, duration, relative time. Polls every 20s. Loading, empty, and error states (including a rate-limit message).
- **Done when:** `npm run dev -w dashboard` shows your real runs; a new push appears within ~20s without a page refresh.
- **Commit:** `feat(dashboard): add build history table with polling`

### Phase 11: Stats & charts
- Stat cards: pass rate, total runs, p50/p95 duration, flaky commits. Charts (Recharts): daily pass/fail stacked bars; duration per run line; stage-failure bar chart.
- **Done when:** numbers match a manual count of the last 10 runs in the Actions tab.
- **Commit:** `feat(dashboard): add pass-rate, duration, and stage-failure charts`

### Phase 12: Run detail & log viewer
- Click a run → its jobs (with per-job status and duration) → click a job → collapsible log groups; groups containing errors auto-expand and are highlighted.
- **Done when:** opening a failed run takes you straight to the failing step's error lines.
- **Commit:** `feat(dashboard): add run detail and log viewer`

### Phase 13: Deploy the dashboard
- Production build (`vite build` + `tsc`), the Express server serves `dist/`. Exclude `__tests__` from the `tsc` build. Deploy as a second **Render** free web service built from the repo (root dir `dashboard`, auto-deploy on push to main). Set `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` in Render's Environment tab (never commit them).
- **Done when:** the public dashboard URL loads real data; the token doesn't appear anywhere in browser DevTools (Network/Sources).
- **Commit:** `ci: deploy dashboard`

### Phase 14: Documentation & the 80% metric
- `docs/release-steps.md`: list the manual release steps without the pipeline (lint, test, build image, tag, log in to the registry, push, trigger the deploy, wait, curl health, verify version) and with it (push, check dashboard). Show the count and the % reduction honestly.
- README: one-paragraph pitch, architecture diagram, screenshots/GIF of the dashboard, live links (service `/health`, dashboard), Actions status badge, "How to run locally", "What I learned".
- **Done when:** a stranger could clone and run it from the README alone; the badge is green.
- **Commit:** `docs: add readme, architecture diagram, and release-step analysis`

---

## 7. Stretch ideas (only after Phase 14)

- PR preview: comment on the PR with lint/test results.
- Automatic rollback: if the health check fails, redeploy the previous `sha-` tag.
- Matrix test job (Node 22 + 24).
- "Simulate failure" button in the dashboard that triggers a workflow_dispatch with a flag that fails a chosen stage, to demo failure handling live.
