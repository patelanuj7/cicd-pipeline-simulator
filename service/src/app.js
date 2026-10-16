import express from 'express';

// Captured once at module load, so uptime reflects how long this process has served.
const startedAt = Date.now();

export const app = express();

app.get('/', (_req, res) => {
  res.json({ message: 'Hello from the CI/CD pipeline simulator service' });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    // Baked into the image at build time (Dockerfile ARG/ENV); "dev" when run locally.
    sha: process.env.GIT_SHA ?? 'dev',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  });
});

// Registered last, so it only runs when no route above matched.
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

export default app;
