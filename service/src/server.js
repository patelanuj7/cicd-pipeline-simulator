import { app } from './app.js';

const port = Number(process.env.PORT) || 3000;

const server = app.listen(port, () => {
  console.log(`service listening on port ${port} (sha: ${process.env.GIT_SHA ?? 'dev'})`);
});

// As PID 1 in a container, Node gets no default signal handling, so without this
// `docker stop` (and the host during a redeploy) waits ~10s and then kills it.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
