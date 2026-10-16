import { existsSync } from 'node:fs';
import { createGitHubClient } from './core/index.js';
import { createApp } from './routes.js';

// Local dev reads dashboard/.env; in production the host sets real env vars.
if (existsSync('.env')) process.loadEnvFile('.env');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy dashboard/.env.example to dashboard/.env and fill it in.`);
    process.exit(1);
  }
  return value;
}

const client = createGitHubClient({
  token: requireEnv('GITHUB_TOKEN'),
  owner: requireEnv('GITHUB_OWNER'),
  repo: requireEnv('GITHUB_REPO'),
});

const app = createApp(client, { workflowFile: process.env.WORKFLOW_FILE });
const port = Number(process.env.PORT) || 8787;

const server = app.listen(port, () => {
  console.log(`dashboard API listening on http://localhost:${port}/api`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
