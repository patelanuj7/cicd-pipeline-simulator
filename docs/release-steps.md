# Release steps: manual vs. automated

This compares what it takes to ship one change to the service **by hand** with what
it takes **with the pipeline**. Each manual step is a real command (or wait) you
would have to run and get right. One-time setup (accounts, the Render service, the
GHCR package, secrets) is the same either way and isn't counted.

## Without the pipeline: 10 steps

Run from the repo root, in Git Bash. `SHA` is the commit being released.

| # | Step | What you run / do |
|---|------|-------------------|
| 1 | Lint | `npm ci && npm run lint` |
| 2 | Test | `bash scripts/run-tests.sh` (service, dashboard, and Python suites) |
| 3 | Build the image | `docker build -f service/Dockerfile --build-arg GIT_SHA=$SHA -t ghcr.io/patelanuj7/cicd-pipeline-simulator-service:sha-${SHA:0:7} .` |
| 4 | Tag it as latest | `docker tag ghcr.io/patelanuj7/cicd-pipeline-simulator-service:sha-${SHA:0:7} ghcr.io/patelanuj7/cicd-pipeline-simulator-service:latest` |
| 5 | Log in to the registry | `docker login ghcr.io -u patelanuj7` (with a personal access token that has `write:packages`) |
| 6 | Push both tags | `docker push ghcr.io/patelanuj7/cicd-pipeline-simulator-service --all-tags` |
| 7 | Trigger the deploy | `curl -X POST "$DEPLOY_HOOK_URL&imgURL=<url-encoded image:sha-tag>"` (the hook URL is a secret you must keep somewhere) |
| 8 | Wait for it to go live | Watch the Render dashboard until the deploy finishes (about 1 minute; longer on a cold start) |
| 9 | Check health | `curl https://cicd-pipeline-simulator-service.onrender.com/health` |
| 10 | Verify the version | Compare the `sha` in that response with `git rev-parse HEAD`. If it's the old SHA, go back to step 8 |

Every step is a chance to skip something or get it wrong: deploying without running
tests, pushing an image built from uncommitted changes, forgetting the `GIT_SHA`
build arg (so `/health` reports `dev`), or curling `/health` once, seeing `"ok"` from
the **old** container, and calling it done.

## With the pipeline: 2 steps

| # | Step | What you run / do |
|---|------|-------------------|
| 1 | Push | `git push` |
| 2 | Check the result | Glance at the dashboard (or the Actions tab): green means the new commit is live and verified |

Everything else runs in `.github/workflows/pipeline.yml`, in order, and stops at the
first failure: lint → test → build and push the image (tagged with the commit SHA) →
trigger Render with that exact image → `scripts/healthcheck.py` polls `/health` until
it reports the new SHA, or fails the run after 5 minutes.

## Result

**10 manual steps → 2 steps: an 80% reduction** (`(10 - 2) / 10`).

Notes on how this is counted, to keep the number honest:

- **Step 2 of the automated flow is optional.** A failed run is visible in the
  dashboard and GitHub emails you about it, so strictly it's 1 required step. I
  count 2 because in practice you look.
- **The manual list already uses this project's scripts.** Without
  `scripts/run-tests.sh`, step 2 would be three separate commands (two Vitest
  suites and pytest), and steps 8–10 would be a hand-rolled polling loop. Counting
  those would make the reduction look bigger; I didn't.
- **Steps 9 and 10 are separate on purpose.** "Healthy" and "running the new
  version" are different checks. The deploy-gate test (run #5 in the Actions
  history) showed the difference: `/health` answered HTTP 200 throughout, but the
  pipeline still failed the deploy because the response wasn't correct.
- **Time isn't counted here, only steps.** A pipeline run takes about 1.5–2 minutes
  end to end; the manual path takes longer and needs someone watching it.
