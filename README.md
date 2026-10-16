# CI/CD Pipeline Simulator

A 4-stage CI/CD pipeline (lint → test → build → deploy) built with GitHub Actions and Docker, plus a React dashboard that reads the GitHub API to show build history, pass/fail rates, and logs.

> 🚧 Work in progress. See [`architecture.md`](architecture.md) for the design and build plan.

---

## Getting started (Phase 0)

Run these in **Command Prompt** or **PowerShell**.

**1. Unzip** `cicd-pipeline-simulator.zip` somewhere easy, for example `C:\Users\<you>\code\`, then open the folder:

```powershell
cd C:\Users\<you>\code\cicd-pipeline-simulator
```

**2. Install dependencies and run the tests**

```powershell
npm install
npm test -w dashboard
npm run typecheck
```

You should see `Tests  50 passed (50)` and no type errors.

**3. Connect it to GitHub and make the first commit**

```powershell
git init -b main
git add .
git status
```

Check that `node_modules` is **not** in the list (it's ignored), then:

```powershell
git commit -m "chore: scaffold monorepo with tested dashboard core"
git remote add origin https://github.com/patelanuj7/cicd-pipeline-simulator.git
git push -u origin main
```

The first push opens a browser window to sign in to GitHub. That's normal.

**4. Open the folder in Cursor** and start Claude Code with:

> Read architecture.md. Phase 0 is done and committed. Do Phase 1, then stop.

---

## Deployment

Both the service and the dashboard run on [Render](https://render.com)'s free tier. No credit card is needed. The deploy stage of the pipeline triggers Render, then the Python health check confirms the new commit is live.

**Free tier trade-off:** a free service sleeps after 15 minutes without traffic, and its first request after that takes about a minute. The pipeline's health check waits up to 5 minutes, so this doesn't break deploys. For recruiters, the README will include screenshots and a GIF so the project makes sense even before the dashboard wakes up. Don't set up a pinger to keep both services awake: two always-on services would use more than the 750 free hours per month.

### Service (set up during Phase 8)
1. After Phase 6, open the package on GitHub (your profile → **Packages** → `cicd-pipeline-simulator-service`) → **Package settings** → change visibility to **Public**.
2. In Render: **New → Web Service → Existing Image**, and enter `ghcr.io/patelanuj7/cicd-pipeline-simulator-service:latest`. Choose instance type **Free**. Set **Health Check Path** to `/health`.
3. In the service's **Settings → Deploy Hook**, copy the URL. Treat it like a password.
4. In GitHub: repo **Settings → Secrets and variables → Actions**:
   - Secret `DEPLOY_HOOK_URL` = the deploy hook URL
   - Variable `SERVICE_URL` = `https://<your-service>.onrender.com`

### Dashboard (set up during Phase 13)
1. In Render: **New → Web Service → connect this GitHub repo**, root directory `dashboard`, instance type **Free**.
2. In **Environment**, add `GITHUB_TOKEN` (a fine-grained token: this repo only, Actions read-only), `GITHUB_OWNER=patelanuj7`, `GITHUB_REPO=cicd-pipeline-simulator`.
