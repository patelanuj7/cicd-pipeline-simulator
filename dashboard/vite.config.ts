import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // The Express API (npm run dev:server) holds the GitHub token; the browser
    // only ever talks to /api on its own origin.
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    // dist/server is the compiled API (tsc); dist/client is what it serves.
    outDir: 'dist/client',
    emptyOutDir: true,
    // The vendor chunk (mostly Recharts) is ~600 kB raw / ~175 kB gzipped and is
    // cached separately, so the default 500 kB warning doesn't apply to it.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Libraries (React, Recharts) change rarely; a separate chunk stays cached
        // in the browser across app deploys.
        codeSplitting: {
          groups: [{ name: 'vendor', test: /node_modules/ }],
        },
      },
    },
  },
});
